import type { DeliveryOrderStatus, UserNotificationType } from '@/lib/user-notifications';

export function getNotificationPresentation(input: {
  type: UserNotificationType;
  orderStatus?: DeliveryOrderStatus;
}) {
  if (input.type === 'promotion') {
    return {
      icon: 'ticket-percent-outline' as const,
      tint: '#FFF7ED',
      iconColor: '#EA580C',
    };
  }

  if (input.type === 'order_created') {
    return {
      icon: 'clipboard-check-outline' as const,
      tint: '#ECFDF3',
      iconColor: '#166534',
    };
  }

  if (input.type === 'message') {
    return {
      icon: 'message-text-outline' as const,
      tint: '#EFF6FF',
      iconColor: '#2563EB',
    };
  }

  if (input.orderStatus === 'driver_assigned') {
    return {
      icon: 'motorbike' as const,
      tint: '#ECFDF3',
      iconColor: '#166534',
    };
  }

  if (input.orderStatus === 'delivered') {
    return {
      icon: 'check-decagram-outline' as const,
      tint: '#ECFDF3',
      iconColor: '#166534',
    };
  }

  if (input.orderStatus === 'cancelled') {
    return {
      icon: 'close-circle-outline' as const,
      tint: '#FEF2F2',
      iconColor: '#DC2626',
    };
  }

  return {
    icon: 'truck-outline' as const,
    tint: '#ECFDF3',
    iconColor: '#166534',
  };
}
