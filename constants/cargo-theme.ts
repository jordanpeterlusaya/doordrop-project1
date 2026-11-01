import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';

export type CargoIcon = ComponentProps<typeof MaterialCommunityIcons>['name'];
export type AppTabKey = 'home' | 'history' | 'account';
export type FlowType = 'parcel' | 'cargo';
export type ParcelScope = 'city' | 'outside';

export const cargoTheme = {
  colors: {
    primary: '#FFE500',
    primaryDark: '#111827',
    primarySoft: '#FFF9CC',
    onPrimary: '#111827',
    ink: '#111827',
    text: '#111827',
    subtext: '#6B7280',
    line: '#E5E7EB',
    surface: '#FFFFFF',
    canvas: '#F7F7F5',
    card: '#F8FAFC',
    success: '#22C55E',
    warning: '#EA580C',
    warningSoft: '#FFF7ED',
    info: '#2563EB',
    infoSoft: '#EFF6FF',
    darkSurface: '#0F172A',
  },
  radius: {
    md: 16,
    lg: 20,
    xl: 28,
    pill: 999,
  },
  /** Page-level proceed/action CTA — matches tickets “Join the waitlist”. */
  cta: {
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: '#111827',
    paddingHorizontal: 20,
    labelSize: 17,
    labelLineHeight: 22,
    labelColor: '#FFFFFF',
    letterSpacing: -0.2,
  },
  /** Send-parcel PrimaryButton before the tickets unify (black, compact radius/type). */
  ctaParcel: {
    minHeight: 56,
    borderRadius: 18,
    backgroundColor: '#111827',
    paddingHorizontal: 16,
    labelSize: 16,
    labelLineHeight: 20,
    labelColor: '#FFFFFF',
    letterSpacing: 0,
  },
  shadow: {
    card: {
      shadowColor: '#111827',
      shadowOpacity: 0.06,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
  },
};

export const bottomTabs: {
  key: AppTabKey;
  label: string;
  icon: CargoIcon;
  route: '/home' | '/history' | '/account';
}[] = [
  { key: 'home', label: 'Home', icon: 'home-variant', route: '/home' },
  { key: 'history', label: 'History', icon: 'history', route: '/history' },
  { key: 'account', label: 'Account', icon: 'account-circle-outline', route: '/account' },
];

export const menuSections: {
  title?: string;
  items: {
    title: string;
    icon: CargoIcon;
    route:
      | '/history'
      | '/account'
      | '/saved-places'
      | '/notifications'
      | '/support-center'
      | '/policies';
  }[];
}[] = [
  {
    items: [
      { title: 'Account', icon: 'account-circle-outline', route: '/account' },
      { title: 'Saved places', icon: 'bookmark-outline', route: '/saved-places' },
      { title: 'Notifications', icon: 'bell-outline', route: '/notifications' },
      { title: 'Help', icon: 'lifebuoy', route: '/support-center' },
      { title: 'Policies', icon: 'shield-check-outline', route: '/policies' },
    ],
  },
];

export const parcelScopes: {
  key: ParcelScope;
  label: string;
  subtitle: string;
}[] = [
  {
    key: 'city',
    label: 'In city',
    subtitle: 'Best for fast urban deliveries with short ETA',
  },
  {
    key: 'outside',
    label: 'Other regions',
    subtitle: 'Long-distance deliveries with planned dispatch',
  },
];

export const parcelPackages: {
  key: string;
  title: string;
  subtitle: string;
  icon: CargoIcon;
}[] = [
  {
    key: 'document',
    title: 'Documents',
    subtitle: 'Contracts, letters and paperwork',
    icon: 'file-document-outline',
  },
  {
    key: 'box',
    title: 'Small box',
    subtitle: 'Gifts, gadgets or daily essentials',
    icon: 'archive-outline',
  },
  {
    key: 'fragile',
    title: 'Fragile item',
    subtitle: 'Handled carefully with added notes',
    icon: 'glass-fragile',
  },
];

export const cargoVehicles: {
  key: string;
  title: string;
  capacity: string;
  eta: string;
  price: string;
  icon: CargoIcon;
  accentColor: string;
  accentBg: string;
}[] = [
  {
    key: 'toyo_electric',
    title: 'Toyo Electric',
    capacity: 'Smaller than TOYO · up to 400 kg',
    eta: '',
    price: 'Toa bei',
    icon: 'rickshaw',
    accentColor: '#0284C7',
    accentBg: '#E0F2FE',
  },
  {
    key: 'toyo',
    title: 'TOYO',
    capacity: 'Bajaji · up to 1 ton',
    eta: '',
    price: 'Toa bei',
    icon: 'car-estate',
    accentColor: '#0369A1',
    accentBg: '#E0F2FE',
  },
  {
    key: 'kirikuu',
    title: 'Kirikuu',
    capacity: 'Pickup · up to 1 ton',
    eta: '',
    price: 'Toa bei',
    icon: 'truck-outline',
    accentColor: '#EA580C',
    accentBg: '#FFF7ED',
  },
];

export const historyOrders = [
  {
    id: 'DD-20481',
    type: 'Cargo van',
    route: 'Mlimani City to Kariakoo',
    status: 'Delivered',
    amount: 'TZS 32,000',
    time: 'Today, 11:40',
  },
  {
    id: 'DD-20462',
    type: 'In-city parcel',
    route: 'Posta to Masaki',
    status: 'Delivered',
    amount: 'TZS 6,500',
    time: 'Yesterday, 18:10',
  },
  {
    id: 'DD-20412',
    type: 'Pickup cargo',
    route: 'Mbezi to Tegeta',
    status: 'Canceled',
    amount: 'TZS 18,000',
    time: 'Apr 10, 09:15',
  },
];

export const accountSections = [
  {
    title: 'Profile',
    items: [
      { label: 'Business profile', value: 'DoorDrop Studio' },
      { label: 'Primary phone', value: '+255 742 000 111' },
      { label: 'Default payment', value: 'Cash on delivery' },
    ],
  },
  {
    title: 'Preferences',
    items: [
      { label: 'Saved addresses', value: '3 places' },
      { label: 'Notifications', value: 'Orders, driver ETA, promos' },
      { label: 'Support', value: '24/7 in-app help' },
    ],
  },
];

export const trackingSteps = [
  { title: 'Order confirmed', note: 'A driver has been matched to your request.' },
  { title: 'Driver on the way', note: 'Estimated arrival to pickup in 8 minutes.' },
  { title: 'Picked up', note: 'Cargo is secured and route is active.' },
  { title: 'Approaching destination', note: 'Delivery is almost complete.' },
];
