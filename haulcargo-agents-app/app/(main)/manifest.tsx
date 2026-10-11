import { Redirect } from 'expo-router';

/** Status changes live on the order screen only. */
export default function ManifestScreen() {
  return <Redirect href="/(main)" />;
}
