export { ErrorBoundary } from '@/components/expo-router-error-boundary';

/**
 * Cold-start entry: render the HAUL letter intro directly.
 * Do not Redirect to /onboarding — that made the letter page feel second.
 */
export { default } from './onboarding';
