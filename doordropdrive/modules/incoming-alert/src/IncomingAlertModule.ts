import { requireNativeModule } from 'expo';

declare class IncomingAlertNativeModule {
  start(): void;
  stop(): void;
  setOnline(enabled: boolean): void;
}

export default requireNativeModule<IncomingAlertNativeModule>('IncomingAlert');
