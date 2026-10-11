import { Redirect, router } from 'expo-router';
import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';

import { AuthShell } from '@/components/auth-shell';
import { StepProgress } from '@/components/step-progress';
import { PrimaryButton } from '@/components/ui';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { carrierDisplayName } from '@/lib/carrier-helpers';
import { useCarrierSession } from '@/providers/carrier-session';

const STEPS = ['Company', 'Verification', 'Approval'] as const;

export default function VerificationPendingScreen() {
  const { user, carrier, refreshCarrier, signOut } = useCarrierSession();

  useEffect(() => {
    const id = setInterval(() => {
      void refreshCarrier();
    }, 12_000);
    return () => clearInterval(id);
  }, [refreshCarrier]);

  const reference = useMemo(() => {
    if (!carrier?.id) return '—';
    return `HAUL-${carrier.id.slice(0, 8).toUpperCase()}`;
  }, [carrier?.id]);

  const companyLabel = carrierDisplayName(carrier);

  if (!user) return <Redirect href="/login" />;
  if (carrier?.status === 'verified') return <Redirect href="/(main)" />;

  if (carrier?.status === 'rejected') {
    return (
      <AuthShell title="Not approved" subtitle="HAUL could not verify this application." back={false}>
        {carrier.rejectionReason ? <Text style={styles.reason}>{carrier.rejectionReason}</Text> : null}
        <PrimaryButton label="Open account" onPress={() => router.replace('/(main)/settings')} />
        <View style={styles.gap} />
        <PrimaryButton
          label="Sign out"
          variant="outline"
          onPress={() => void signOut().finally(() => router.replace('/login'))}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Waiting for approval"
      subtitle="HAUL will notify you when verification completes. Carrier matching stays off until an admin verifies your account."
      back={false}
      stepLabel="Step 3 of 3">
      <StepProgress steps={STEPS} active={2} />

      <Animated.View entering={FadeInDown.duration(360)} style={styles.statusBlock}>
        <View style={styles.statusDot} />
        <View style={styles.statusCopy}>
          <Text style={styles.statusEyebrow}>Application status</Text>
          <Text style={styles.statusTitle}>Pending review</Text>
        </View>
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(60).duration(360)} style={styles.refBlock}>
        <Text style={styles.refLabel}>Application reference</Text>
        <Text style={styles.refValue} selectable>
          {reference}
        </Text>
        {companyLabel !== 'Kampuni' ? <Text style={styles.refCompany}>{companyLabel}</Text> : null}
      </Animated.View>

      <Animated.View entering={FadeInUp.delay(100).duration(360)} style={styles.timeline}>
        <Text style={styles.timelineTitle}>Review timeline</Text>
        <TimelineRow done label="Application submitted" />
        <TimelineRow done label="Phone verified via SMS" />
        <TimelineRow active label="HAUL reviewing your company" />
        <TimelineRow label="Orders unlock when verified" last />
      </Animated.View>

      <PrimaryButton label="Refresh status" onPress={() => void refreshCarrier()} />
      <View style={styles.gap} />
      <PrimaryButton
        label="Sign out"
        variant="outline"
        onPress={() => void signOut().finally(() => router.replace('/login'))}
      />
    </AuthShell>
  );
}

function TimelineRow({
  label,
  done,
  active,
  last,
}: {
  label: string;
  done?: boolean;
  active?: boolean;
  last?: boolean;
}) {
  return (
    <View style={styles.tlRow}>
      <View style={styles.tlRail}>
        <View style={[styles.tlDot, done && styles.tlDotDone, active && styles.tlDotActive]} />
        {!last ? <View style={[styles.tlLine, done && styles.tlLineDone]} /> : null}
      </View>
      <Text style={[styles.tlLabel, (done || active) && styles.tlLabelOn]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statusBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 18,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.warning,
  },
  statusCopy: { flex: 1 },
  statusEyebrow: {
    fontFamily: typography.semibold,
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: theme.muted,
    marginBottom: 2,
  },
  statusTitle: {
    fontFamily: typography.bold,
    fontSize: 18,
    color: theme.ink,
    letterSpacing: -0.2,
  },
  refBlock: {
    marginBottom: 20,
  },
  refLabel: {
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
    marginBottom: 4,
  },
  refValue: {
    fontFamily: typography.bold,
    fontSize: 16,
    color: theme.navy,
    letterSpacing: 0.6,
  },
  refCompany: {
    marginTop: 4,
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
  },
  timeline: { marginBottom: 22 },
  timelineTitle: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
    marginBottom: 12,
  },
  tlRow: { flexDirection: 'row', gap: 12, minHeight: 36 },
  tlRail: { width: 16, alignItems: 'center' },
  tlDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.border,
    backgroundColor: theme.white,
    marginTop: 4,
  },
  tlDotDone: { backgroundColor: theme.accent, borderColor: theme.accent },
  tlDotActive: { borderColor: theme.warning, backgroundColor: '#FEF3C7' },
  tlLine: {
    flex: 1,
    width: 1.5,
    backgroundColor: theme.border,
    marginVertical: 2,
  },
  tlLineDone: { backgroundColor: theme.accent },
  tlLabel: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.muted,
    paddingBottom: 14,
  },
  tlLabelOn: { color: theme.ink, fontFamily: typography.semibold },
  reason: {
    color: theme.danger,
    fontFamily: typography.semibold,
    marginBottom: 14,
    lineHeight: 20,
  },
  gap: { height: 10 },
});
