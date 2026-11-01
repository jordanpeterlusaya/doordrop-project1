export function getFirebaseAuthErrorMessage(code?: string) {
  switch (code) {
    case 'auth/app-not-authorized':
      return 'This app is not authorized for Firebase Authentication with the current API key or domain configuration.';
    case 'auth/invalid-api-key':
      return 'The Firebase API key is invalid. Check the app configuration.';
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled in Firebase Authentication.';
    case 'auth/unauthorized-domain':
      return 'This app domain is not authorized in Firebase Authentication.';
    case 'auth/email-already-in-use':
      return 'That email is already in use. Try signing in instead.';
    case 'auth/invalid-email':
      return 'Enter a valid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Your email or password is incorrect.';
    case 'auth/weak-password':
      return 'Use a stronger password with at least 6 characters.';
    case 'auth/too-many-requests':
      return 'Too many attempts right now. Please wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

export function getFirebasePasswordResetErrorMessage(code?: string) {
  switch (code) {
    case 'auth/missing-email':
      return 'Enter the email address linked to your account.';
    case 'auth/user-not-found':
      return 'We could not find an account with that email address.';
    default:
      return getFirebaseAuthErrorMessage(code);
  }
}

export function getFirebaseDataErrorMessage(code?: string, fallback = 'Something went wrong. Please try again.') {
  switch (code) {
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'Firebase blocked this action. Check your Firestore rules for drivers and orders.';
    case 'unauthenticated':
    case 'firestore/unauthenticated':
      return 'Sign in again before trying this action.';
    case 'unavailable':
    case 'firestore/unavailable':
    case 'network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'failed-precondition':
    case 'firestore/failed-precondition':
      return 'Firestore is not ready for this action yet. Confirm the database exists and required indexes are ready.';
    default:
      return fallback;
  }
}
