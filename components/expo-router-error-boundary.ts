import { RouteErrorBoundary } from '@/components/ErrorBoundary';

// Hermes minifies away `export { RouteErrorBoundary as ErrorBoundary } from ...`,
// which crashes expo-router while loading routes. Keep a real local binding.
export const ErrorBoundary = RouteErrorBoundary;
