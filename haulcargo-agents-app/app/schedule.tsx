import { Redirect } from 'expo-router';

/** Capacity and operating days are not part of the company desk. */
export default function ScheduleRedirect() {
  return <Redirect href="/(main)/settings" />;
}
