import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'haul.commissionPayIntent.v1';

export type CommissionPayIntent = {
  carrierId: string;
  phone: string;
  network: 'mpesa' | 'mixx' | 'airtel';
  amount: number;
  at: string;
};

/** Local note only. Does not tell a provider and does not mark commission paid. */
export async function loadCommissionPayIntent(carrierId: string): Promise<CommissionPayIntent | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommissionPayIntent;
    if (!parsed || parsed.carrierId !== carrierId) return null;
    if (parsed.network !== 'mpesa' && parsed.network !== 'mixx' && parsed.network !== 'airtel') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCommissionPayIntent(intent: CommissionPayIntent) {
  await AsyncStorage.setItem(KEY, JSON.stringify(intent));
}
