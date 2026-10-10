import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ADMIN_EMAIL } from '@/constants/theme';
import { loginAuthErrorMessage } from '@/lib/auth-errors';
import { createCarrierFromRegistration, type RegisterCompanyInput } from '@/lib/carrier-registration';
import type { Carrier, CarrierRoute, CarrierShipment } from '@/lib/carrier-types';
import { isIncomingOffer } from '@/lib/carrier-helpers';
import { auth, db } from '@/lib/firebase';
import { registerCarrierPushToken, vibrateForNewOffer } from '@/lib/push-notifications';

type CarrierSessionValue = {
  user: User | null;
  initializing: boolean;
  authenticating: boolean;
  authError: string;
  clearAuthError: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, company: RegisterCompanyInput) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  carrier: Carrier | null;
  isAdmin: boolean;
  needsCompanySetup: boolean;
  shipments: CarrierShipment[];
  routes: CarrierRoute[];
  refreshCarrier: () => Promise<void>;
};

const CarrierSessionContext = createContext<CarrierSessionValue | undefined>(undefined);

export function CarrierSessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [initializing, setInitializing] = useState(true);
  const [authenticating, setAuthenticating] = useState(false);
  const [authError, setAuthError] = useState('');
  const [carrier, setCarrier] = useState<Carrier | null>(null);
  const [needsCompanySetup, setNeedsCompanySetup] = useState(false);
  const [shipments, setShipments] = useState<CarrierShipment[]>([]);
  const [routes, setRoutes] = useState<CarrierRoute[]>([]);
  const knownOfferIds = useRef<Set<string>>(new Set());
  const offersReady = useRef(false);

  const isAdmin = user?.email?.toLowerCase() === ADMIN_EMAIL;

  const clearAuthError = useCallback(() => setAuthError(''), []);

  const resolveCarrier = useCallback(async (nextUser: User | null) => {
    if (!nextUser) {
      setCarrier(null);
      setNeedsCompanySetup(false);
      return;
    }
    if (isAdmin && nextUser.email?.toLowerCase() === ADMIN_EMAIL) {
      const memberSnap = await getDoc(doc(db, 'carrierMembers', nextUser.uid));
      if (!memberSnap.exists()) {
        const owned = await getDoc(doc(db, 'carriers', nextUser.uid));
        if (!owned.exists()) {
          setCarrier(null);
          setNeedsCompanySetup(false);
          return;
        }
      }
    }
    const memberSnap = await getDoc(doc(db, 'carrierMembers', nextUser.uid));
    if (!memberSnap.exists() && nextUser.email?.toLowerCase() !== ADMIN_EMAIL) {
      const ownedCarrierSnap = await getDoc(doc(db, 'carriers', nextUser.uid));
      if (!ownedCarrierSnap.exists()) {
        setCarrier(null);
        setNeedsCompanySetup(true);
        return;
      }
    }
    setNeedsCompanySetup(false);
    const carrierId = memberSnap.exists()
      ? (memberSnap.data().carrierId as string)
      : nextUser.email?.toLowerCase() === ADMIN_EMAIL
        ? ''
        : nextUser.uid;
    if (!carrierId) {
      setCarrier(null);
      return;
    }
    const carrierSnap = await getDoc(doc(db, 'carriers', carrierId));
    setCarrier(carrierSnap.exists() ? { id: carrierSnap.id, ...carrierSnap.data() } : null);
  }, [isAdmin]);

  const refreshCarrier = useCallback(async () => {
    await resolveCarrier(user);
  }, [resolveCarrier, user]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      resolveCarrier(nextUser)
        .catch(console.error)
        .finally(() => setInitializing(false));
    });
    return unsub;
  }, [resolveCarrier]);

  useEffect(() => {
    if (!carrier?.id || !user?.uid) return;
    void registerCarrierPushToken({ uid: user.uid, carrierId: carrier.id }).catch(() => undefined);
  }, [carrier?.id, user?.uid]);

  useEffect(() => {
    if (!carrier?.id) {
      setShipments([]);
      setRoutes([]);
      knownOfferIds.current = new Set();
      offersReady.current = false;
      return;
    }
    const id = carrier.id;
    const buckets: { offered: CarrierShipment[]; owned: CarrierShipment[] } = { offered: [], owned: [] };
    const publish = () => {
      const map = new Map<string, CarrierShipment>();
      [...buckets.offered, ...buckets.owned].forEach((item) => map.set(item.id, item));
      const next = [...map.values()];
      const openOffers = next.filter((item) => isIncomingOffer(item, id));
      const nextIds = new Set(openOffers.map((item) => item.id));
      if (!offersReady.current) {
        knownOfferIds.current = nextIds;
        offersReady.current = true;
      } else {
        for (const offerId of nextIds) {
          if (!knownOfferIds.current.has(offerId)) {
            vibrateForNewOffer();
            break;
          }
        }
        knownOfferIds.current = nextIds;
      }
      setShipments(next);
    };
    const unsubs = [
      onSnapshot(query(collection(db, 'carrierShipments'), where('offeredCarrierId', '==', id)), (snap) => {
        buckets.offered = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CarrierShipment[];
        publish();
      }),
      onSnapshot(query(collection(db, 'carrierShipments'), where('carrierId', '==', id)), (snap) => {
        buckets.owned = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CarrierShipment[];
        publish();
      }),
      onSnapshot(query(collection(db, 'carrierRoutes'), where('carrierId', '==', id)), (snap) => {
        setRoutes(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as CarrierRoute[]);
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [carrier?.id]);

  const signIn = useCallback(async (email: string, password: string) => {
    setAuthenticating(true);
    setAuthError('');
    try {
      await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
    } catch (error) {
      const code = error instanceof FirebaseError ? error.code : '';
      setAuthError(loginAuthErrorMessage(code));
      throw error;
    } finally {
      setAuthenticating(false);
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, company: RegisterCompanyInput) => {
    setAuthenticating(true);
    setAuthError('');
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await createCarrierFromRegistration(credential.user, company, email.trim().toLowerCase());
      setNeedsCompanySetup(false);
      await resolveCarrier(credential.user);
    } catch (error) {
      const code = error instanceof FirebaseError ? error.code : '';
      setAuthError(error instanceof Error && !code.startsWith('auth/') ? error.message : loginAuthErrorMessage(code));
      throw error;
    } finally {
      setAuthenticating(false);
    }
  }, [resolveCarrier]);

  const signOut = useCallback(async () => {
    setNeedsCompanySetup(false);
    await firebaseSignOut(auth);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim().toLowerCase());
  }, []);

  const value = useMemo(
    () => ({
      user,
      initializing,
      authenticating,
      authError,
      clearAuthError,
      signIn,
      signUp,
      signOut,
      resetPassword,
      carrier,
      isAdmin,
      needsCompanySetup,
      shipments,
      routes,
      refreshCarrier,
    }),
    [
      user,
      initializing,
      authenticating,
      authError,
      clearAuthError,
      signIn,
      signUp,
      signOut,
      resetPassword,
      carrier,
      isAdmin,
      needsCompanySetup,
      shipments,
      routes,
      refreshCarrier,
    ]
  );

  return <CarrierSessionContext.Provider value={value}>{children}</CarrierSessionContext.Provider>;
}

export function useCarrierSession() {
  const ctx = useContext(CarrierSessionContext);
  if (!ctx) throw new Error('useCarrierSession must be used within CarrierSessionProvider');
  return ctx;
}
