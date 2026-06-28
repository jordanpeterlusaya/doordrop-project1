import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';
import {
  createUserWithEmailAndPassword,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  updateProfile as updateFirebaseProfile,
} from 'firebase/auth';

import { getFirebaseAuthErrorMessage } from '@/lib/auth-errors';
import { logAsyncFailure, logAsyncStart, logAsyncSuccess, logInfo, logWarning } from '@/lib/debug-logger';
import { auth } from '@/lib/firebase';
import { getUserProfile, recordUserAppOpen, type UserProfile, upsertUserProfile } from '@/lib/user-profile';

type AuthContextValue = {
  authError: string;
  authMethod: 'google' | 'email' | 'guest';
  authenticating: boolean;
  clearAuthError: () => void;
  googleAuthReady: boolean;
  initializing: boolean;
  profile: UserProfile | null;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
  registerWithEmail: (input: {
    fullName: string;
    email: string;
    password: string;
    phoneNumber: string;
  }) => Promise<void>;
  signInWithEmail: (input: { email: string; password: string }) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  user: User | null;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const NATIVE_GOOGLE_AUTH_MESSAGE =
  'Google sign-in is not available in this APK yet. Use email and password while native Google setup is completed.';
const authScope = 'AuthProvider';
const fallbackAuthContextValue: AuthContextValue = {
  authError: '',
  authMethod: 'guest',
  authenticating: false,
  clearAuthError: () => undefined,
  googleAuthReady: Platform.OS === 'web',
  initializing: false,
  profile: null,
  profileLoading: false,
  refreshProfile: async () => undefined,
  registerWithEmail: async () => undefined,
  signInWithEmail: async () => undefined,
  signInWithGoogle: async () => undefined,
  signOut: async () => undefined,
  user: null,
};

function buildFallbackProfile(nextUser: User): UserProfile {
  return {
    uid: nextUser.uid,
    fullName: nextUser.displayName?.trim() || 'DoorDrop User',
    email: nextUser.email?.trim().toLowerCase() || '',
    phoneNumber: nextUser.phoneNumber || '',
    phoneVerified: false,
  };
}

function createGoogleProvider() {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({
    prompt: 'select_account',
  });
  return provider;
}

function getAuthMethod(nextUser: User | null): 'google' | 'email' | 'guest' {
  if (nextUser?.providerData.some((item) => item.providerId === 'google.com')) {
    return 'google';
  }

  if (nextUser?.providerData.some((item) => item.providerId === 'password')) {
    return 'email';
  }

  return 'guest';
}

function getAuthMessage(error: unknown, fallback: string) {
  if (error instanceof FirebaseError) {
    return getFirebaseAuthErrorMessage(error.code);
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');

  const clearAuthError = useCallback(() => {
    setAuthError('');
  }, []);

  const hydrateProfile = useCallback(async (nextUser: User) => {
    logAsyncStart(authScope, 'hydrateProfile', { uid: nextUser.uid });
    setProfileLoading(true);

    try {
      const nextProfile = await getUserProfile(nextUser.uid);
      setProfile(nextProfile ?? buildFallbackProfile(nextUser));
      logAsyncSuccess(authScope, 'hydrateProfile', {
        uid: nextUser.uid,
        profileFound: Boolean(nextProfile),
      });
    } catch (error) {
      logAsyncFailure(authScope, 'hydrateProfile', error, { uid: nextUser.uid });
      setProfile((currentProfile) =>
        currentProfile?.uid === nextUser.uid ? currentProfile : buildFallbackProfile(nextUser)
      );
    } finally {
      setProfileLoading(false);
    }
  }, []);

  const trackAppOpen = useCallback(async (nextUser: User) => {
    logAsyncStart(authScope, 'trackAppOpen', { uid: nextUser.uid });
    try {
      await recordUserAppOpen({
        uid: nextUser.uid,
        fullName: nextUser.displayName?.trim() || 'DoorDrop User',
        email: nextUser.email?.trim().toLowerCase() || '',
        phoneNumber: nextUser.phoneNumber || '',
        phoneVerified: false,
      });
      logAsyncSuccess(authScope, 'trackAppOpen', { uid: nextUser.uid });
    } catch (error) {
      logAsyncFailure(authScope, 'trackAppOpen', error, { uid: nextUser.uid });
      return;
    }
  }, []);

  const syncGoogleProfile = useCallback(async (nextUser: User) => {
    logAsyncStart(authScope, 'syncGoogleProfile', { uid: nextUser.uid });
    await upsertUserProfile({
      uid: nextUser.uid,
      fullName: nextUser.displayName?.trim() || 'DoorDrop User',
      email: nextUser.email?.trim().toLowerCase() || '',
      phoneNumber: nextUser.phoneNumber || '',
      phoneVerified: false,
    });
    logAsyncSuccess(authScope, 'syncGoogleProfile', { uid: nextUser.uid });
  }, []);

  const syncEmailProfile = useCallback(
    async (input: {
      uid: string;
      fullName: string;
      email: string;
      phoneNumber: string;
    }) => {
      logAsyncStart(authScope, 'syncEmailProfile', { uid: input.uid });
      await upsertUserProfile({
        uid: input.uid,
        fullName: input.fullName.trim() || 'DoorDrop User',
        email: input.email.trim().toLowerCase(),
        phoneNumber: input.phoneNumber.trim(),
        phoneVerified: false,
      });
      logAsyncSuccess(authScope, 'syncEmailProfile', { uid: input.uid });
    },
    []
  );

  useEffect(() => {
    let active = true;
    let appOpenTimeoutId: ReturnType<typeof setTimeout> | undefined;
    let appOpenInteractionTask: ReturnType<typeof InteractionManager.runAfterInteractions> | undefined;

    const scheduleTrackAppOpen = (nextUser: User) => {
      appOpenInteractionTask?.cancel();
      if (appOpenTimeoutId) {
        clearTimeout(appOpenTimeoutId);
      }

      appOpenInteractionTask = InteractionManager.runAfterInteractions(() => {
        appOpenTimeoutId = setTimeout(() => {
          if (!active || auth.currentUser?.uid !== nextUser.uid) {
            return;
          }

          void trackAppOpen(nextUser);
        }, 1800);
      });
    };

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        if (!active) {
          return;
        }

        logInfo(authScope, 'auth-state-changed', {
          uid: nextUser?.uid ?? null,
          authenticated: Boolean(nextUser),
        });

        setUser(nextUser);
        setInitializing(false);
        setAuthenticating(false);
        setAuthError('');

        if (!nextUser) {
          setProfile(null);
          setProfileLoading(false);
          return;
        }

        setProfile((currentProfile) =>
          currentProfile?.uid === nextUser.uid ? currentProfile : buildFallbackProfile(nextUser)
        );

        void hydrateProfile(nextUser);
        scheduleTrackAppOpen(nextUser);
      },
      (error) => {
        if (!active) {
          return;
        }

        logAsyncFailure(authScope, 'restoreSession', error);
        setUser(null);
        setProfile(null);
        setProfileLoading(false);
        setAuthenticating(false);
        setInitializing(false);
        setAuthError(getAuthMessage(error, 'We could not restore your session. Please sign in again.'));
      }
    );

    return () => {
      active = false;
      appOpenInteractionTask?.cancel();
      if (appOpenTimeoutId) {
        clearTimeout(appOpenTimeoutId);
      }
      unsubscribe();
    };
  }, [hydrateProfile, trackAppOpen]);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      return;
    }

    let active = true;

    logAsyncStart(authScope, 'getRedirectResult');
    void getRedirectResult(auth)
      .then(async (result) => {
        if (!active || !result?.user) {
          logAsyncSuccess(authScope, 'getRedirectResult', { completed: false });
          return;
        }

        await syncGoogleProfile(result.user).catch(() => null);
        clearAuthError();
        logAsyncSuccess(authScope, 'getRedirectResult', {
          completed: true,
          uid: result.user.uid,
        });
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }

        logAsyncFailure(authScope, 'getRedirectResult', error);
        setAuthError(getAuthMessage(error, 'Google sign-in did not finish. Please try again.'));
      })
      .finally(() => {
        if (active) {
          setAuthenticating(false);
        }
      });

    return () => {
      active = false;
    };
  }, [clearAuthError, syncGoogleProfile]);

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) {
      logWarning(authScope, 'refreshProfile skipped without current user');
      setProfile(null);
      return;
    }

    logAsyncStart(authScope, 'refreshProfile', { uid: auth.currentUser.uid });
    await hydrateProfile(auth.currentUser);
    logAsyncSuccess(authScope, 'refreshProfile', { uid: auth.currentUser.uid });
  }, [hydrateProfile]);

  const signInWithGoogle = useCallback(async () => {
    if (authenticating) {
      logWarning(authScope, 'signInWithGoogle ignored while authenticating');
      return;
    }

    clearAuthError();

    if (Platform.OS !== 'web') {
      logWarning(authScope, 'signInWithGoogle unavailable on native build');
      setAuthError(NATIVE_GOOGLE_AUTH_MESSAGE);
      return;
    }

    setAuthenticating(true);
    logAsyncStart(authScope, 'signInWithGoogle');

    try {
      const provider = createGoogleProvider();

      try {
        const result = await signInWithPopup(auth, provider);
        await syncGoogleProfile(result.user).catch(() => null);
        clearAuthError();
        logAsyncSuccess(authScope, 'signInWithGoogle', { uid: result.user.uid, mode: 'popup' });
      } catch (error) {
        if (
          error instanceof FirebaseError &&
          (error.code === 'auth/popup-blocked' ||
            error.code === 'auth/popup-closed-by-user' ||
            error.code === 'auth/cancelled-popup-request')
        ) {
          logInfo(authScope, 'signInWithGoogle falling back to redirect');
          await signInWithRedirect(auth, provider);
          return;
        }

        throw error;
      }
    } catch (error) {
      logAsyncFailure(authScope, 'signInWithGoogle', error);
      setAuthError(getAuthMessage(error, 'Google sign-in failed. Please try again.'));
    } finally {
      setAuthenticating(false);
    }
  }, [authenticating, clearAuthError, syncGoogleProfile]);

  const signInWithEmail = useCallback(
    async (input: { email: string; password: string }) => {
      if (authenticating) {
        logWarning(authScope, 'signInWithEmail ignored while authenticating');
        return;
      }

      setAuthenticating(true);
      clearAuthError();
      logAsyncStart(authScope, 'signInWithEmail', { email: input.email.trim().toLowerCase() });

      try {
        await signInWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
        logAsyncSuccess(authScope, 'signInWithEmail', { email: input.email.trim().toLowerCase() });
      } catch (error) {
        logAsyncFailure(authScope, 'signInWithEmail', error, {
          email: input.email.trim().toLowerCase(),
        });
        setAuthError(getAuthMessage(error, 'Sign-in failed. Please try again.'));
      } finally {
        setAuthenticating(false);
      }
    },
    [authenticating, clearAuthError]
  );

  const registerWithEmail = useCallback(
    async (input: {
      fullName: string;
      email: string;
      password: string;
      phoneNumber: string;
    }) => {
      if (authenticating) {
        logWarning(authScope, 'registerWithEmail ignored while authenticating');
        return;
      }

      setAuthenticating(true);
      clearAuthError();
      logAsyncStart(authScope, 'registerWithEmail', { email: input.email.trim().toLowerCase() });

      try {
        const fullName = input.fullName.trim();
        const email = input.email.trim().toLowerCase();
        const phoneNumber = input.phoneNumber.trim();
        const result = await createUserWithEmailAndPassword(auth, email, input.password);
        const nextProfile = {
          uid: result.user.uid,
          fullName: fullName || result.user.displayName || 'DoorDrop User',
          email,
          phoneNumber,
          phoneVerified: false,
        } satisfies UserProfile;

        if (fullName) {
          await updateFirebaseProfile(result.user, {
            displayName: fullName,
          });
        }

        setProfile(nextProfile);
        await syncEmailProfile(nextProfile).catch(() => null);
        logAsyncSuccess(authScope, 'registerWithEmail', {
          email,
          uid: result.user.uid,
        });
      } catch (error) {
        logAsyncFailure(authScope, 'registerWithEmail', error, {
          email: input.email.trim().toLowerCase(),
        });
        setAuthError(getAuthMessage(error, 'Registration failed. Please try again.'));
      } finally {
        setAuthenticating(false);
      }
    },
    [authenticating, clearAuthError, syncEmailProfile]
  );

  const signOut = useCallback(async () => {
    clearAuthError();
    setAuthenticating(false);
    logAsyncStart(authScope, 'signOut', { uid: auth.currentUser?.uid ?? null });

    try {
      await firebaseSignOut(auth);
      logAsyncSuccess(authScope, 'signOut');
    } catch (error) {
      logAsyncFailure(authScope, 'signOut', error);
      throw error;
    }
  }, [clearAuthError]);

  const value = useMemo(
    () => ({
      authError,
      authMethod: getAuthMethod(user),
      authenticating,
      clearAuthError,
      googleAuthReady: Platform.OS === 'web',
      initializing,
      profile,
      profileLoading,
      refreshProfile,
      registerWithEmail,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      user,
    }),
    [
      authError,
      authenticating,
      clearAuthError,
      initializing,
      profile,
      profileLoading,
      refreshProfile,
      registerWithEmail,
      signInWithEmail,
      signInWithGoogle,
      signOut,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthContext);
  return context ?? fallbackAuthContextValue;
}
