import { MaterialCommunityIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import type { OutsideLogisticsStatus } from '@/lib/outside-order-logistics';

type TimelineStep = {
  key: OutsideLogisticsStatus | 'confirmed';
  labelSw: string;
  labelEn: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
};

const EXPRESS_STEPS: TimelineStep[] = [
  { key: 'confirmed', labelSw: 'Imethibitishwa', labelEn: 'Confirmed', icon: 'check-circle-outline' },
  { key: 'first_mile_assigned', labelSw: 'Inachukuliwa', labelEn: 'Collecting', icon: 'motorbike' },
  { key: 'received_at_hub', labelSw: 'Uwanjani / ofisi', labelEn: 'At hub / airport', icon: 'airport' },
  { key: 'in_transit_carrier', labelSw: 'Ndege / basi', labelEn: 'In transit', icon: 'airplane' },
  { key: 'arrived_destination', labelSw: 'Imewasili', labelEn: 'Arrived', icon: 'map-marker-check-outline' },
  { key: 'completed', labelSw: 'Imepokelewa', labelEn: 'Received', icon: 'package-variant-closed-check' },
];

const STATUS_RANK: Record<string, number> = {
  confirmed: 0,
  awaiting_dispatch: 0,
  first_mile_assigned: 1,
  awaiting_hub_intake: 2,
  received_at_hub: 2,
  in_transit_carrier: 3,
  arrived_destination: 4,
  out_for_delivery: 4,
  completed: 5,
};

type Props = {
  language: 'sw' | 'en';
  logisticsStatus?: string | null;
  orderStatus?: string | null;
};

export function OutsideParcelOrderTimeline({ language, logisticsStatus, orderStatus }: Props) {
  const activeRank = resolveTimelineRank(logisticsStatus, orderStatus);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{language === 'sw' ? 'Hatua za usafirishaji' : 'Delivery milestones'}</Text>
      {EXPRESS_STEPS.map((step, index) => {
        const stepRank = STATUS_RANK[step.key] ?? index;
        const done = activeRank > stepRank;
        const active = activeRank === stepRank;
        return (
          <View key={step.key} style={styles.row}>
            <View style={[styles.iconWrap, done && styles.iconWrapDone, active && styles.iconWrapActive]}>
              <MaterialCommunityIcons
                name={step.icon}
                size={16}
                color={done || active ? cargoTheme.colors.primaryDark : '#94A3B8'}
              />
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, (done || active) && styles.labelActive]}>
                {language === 'sw' ? step.labelSw : step.labelEn}
              </Text>
              {active ? (
                <Text style={styles.activeHint}>{language === 'sw' ? 'Hatua ya sasa' : 'Current step'}</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function resolveTimelineRank(logisticsStatus?: string | null, orderStatus?: string | null) {
  const key = String(logisticsStatus || '').trim();
  if (key && key in STATUS_RANK) {
    return STATUS_RANK[key];
  }
  if (orderStatus === 'delivered') {
    return STATUS_RANK.completed;
  }
  if (orderStatus === 'pending_assignment') {
    return STATUS_RANK.confirmed;
  }
  return STATUS_RANK.confirmed;
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8EEF3',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    marginBottom: 12,
  },
  title: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.bold,
    color: '#0F172A',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconWrap: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
  },
  iconWrapDone: {
    backgroundColor: '#ECFDF3',
  },
  iconWrapActive: {
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: cargoTheme.colors.primary,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  label: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: typography.semibold,
    color: '#64748B',
  },
  labelActive: {
    color: '#0F172A',
  },
  activeHint: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.medium,
    color: cargoTheme.colors.primaryDark,
  },
});
