import { Redirect } from 'expo-router';

/** Company document uploads are not part of the company desk. */
export default function EditDocumentsRedirect() {
  return <Redirect href="/(main)/settings" />;
}
