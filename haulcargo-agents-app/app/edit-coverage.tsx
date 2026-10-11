import { Redirect } from 'expo-router';

/** Legacy route — Operation Coverage lives at `/operation-coverage`. */
export default function EditCoverageRedirect() {
  return <Redirect href={{ pathname: '/operation-coverage', params: { mode: 'edit' } }} />;
}
