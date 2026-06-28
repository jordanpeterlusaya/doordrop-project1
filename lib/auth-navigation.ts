export type AuthReturnRoute = '/home' | '/order-review' | `/order-review?${string}`;

export function resolveAuthReturnTo(value?: string | string[]): AuthReturnRoute {
  const nextValue = Array.isArray(value) ? value[0] : value;
  if (nextValue === '/order-review' || nextValue?.startsWith('/order-review?')) {
    return nextValue as AuthReturnRoute;
  }

  return '/home';
}
