import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

export type OutsideParcelProgressStep = 'city' | 'mode' | 'flight' | 'weight' | 'recipient';

type StepDef = { key: OutsideParcelProgressStep; labelSw: string; labelEn: string };

const STEPS: StepDef[] = [
  { key: 'city', labelSw: 'Mkoa', labelEn: 'Region' },
  { key: 'mode', labelSw: 'Njia', labelEn: 'Mode' },
  { key: 'flight', labelSw: 'Ndege', labelEn: 'Flight' },
  { key: 'weight', labelSw: 'Uzito', labelEn: 'Weight' },
  { key: 'recipient', labelSw: 'Mpokeaji', labelEn: 'Recipient' },
];

type Props = {
  language: 'sw' | 'en';
  currentStep: OutsideParcelProgressStep;
  expressFlow?: boolean;
  loading?: boolean;
};

export function resolveOutsideParcelProgressStep(input: {
  hasCity: boolean;
  hasMode: boolean;
  expressFlow: boolean;
  expressFlightReady: boolean;
  weightReady: boolean;
  recipientReady: boolean;
}): OutsideParcelProgressStep {
  if (!input.hasCity) {
    return 'city';
  }
  if (!input.hasMode) {
    return 'mode';
  }
  if (input.expressFlow && !input.expressFlightReady) {
    return 'flight';
  }
  if (!input.weightReady) {
    return 'weight';
  }
  if (!input.recipientReady) {
    return 'recipient';
  }
  return 'recipient';
}

export function OutsideParcelWizardBar({
  language,
  step,
}: {
  language: 'sw' | 'en';
  step: 1 | 2 | 3;
}) {
  const labels = language === 'sw' ? ['Mkoa', 'Mpokeaji', 'Ukubwa'] : ['Region', 'Recipient', 'Size'];

  return (
    <View style={styles.wizardWrap} accessibilityRole="progressbar">
      {labels.map((label, index) => {
        const number = (index + 1) as 1 | 2 | 3;
        const active = number === step;
        const done = number < step;
        return (
          <View key={label} style={styles.wizardItem}>
            <View style={[styles.wizardDot, done && styles.wizardDotDone, active && styles.wizardDotActive]}>
              <Text
                style={[
                  styles.wizardDotText,
                  done && styles.wizardDotTextOn,
                  active && styles.wizardDotTextActive,
                ]}>
                {done ? '✓' : number}
              </Text>
            </View>
            <Text style={[styles.wizardLabel, active && styles.wizardLabelActive]}>{label}</Text>
            {index < labels.length - 1 ? <View style={[styles.wizardLine, done && styles.wizardLineDone]} /> : null}
          </View>
        );
      })}
    </View>
  );
}

export function OutsideParcelProgressBar({ language, currentStep, expressFlow = true, loading = false }: Props) {
  const visibleSteps = expressFlow ? STEPS : STEPS.filter((step) => step.key !== 'flight');
  const currentIndex = visibleSteps.findIndex((step) => step.key === currentStep);

  if (loading) {
    return (
      <View style={styles.wrap}>
        <View style={styles.skeletonTrack} />
        <View style={styles.skeletonLabels}>
          {visibleSteps.map((step) => (
            <View key={step.key} style={styles.skeletonLabel} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.wrap} accessibilityRole="progressbar">
      <View style={styles.trackRow}>
        {visibleSteps.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          const upcoming = index > currentIndex;
          return (
            <React.Fragment key={step.key}>
              <View
                style={[
                  styles.dot,
                  done && styles.dotDone,
                  active && styles.dotActive,
                  upcoming && styles.dotUpcoming,
                ]}
              />
              {index < visibleSteps.length - 1 ? (
                <View style={[styles.connector, done && styles.connectorDone, active && styles.connectorActive]} />
              ) : null}
            </React.Fragment>
          );
        })}
      </View>
      <View style={styles.labelRow}>
        {visibleSteps.map((step, index) => {
          const active = index === currentIndex;
          const done = index < currentIndex;
          return (
            <Text
              key={step.key}
              numberOfLines={1}
              style={[styles.label, active && styles.labelActive, done && styles.labelDone]}>
              {language === 'sw' ? step.labelSw : step.labelEn}
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
    gap: 8,
  },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: '#CBD5E1',
  },
  dotDone: {
    backgroundColor: cargoTheme.colors.primary,
  },
  dotActive: {
    backgroundColor: cargoTheme.colors.primaryDark,
    transform: [{ scale: 1.15 }],
  },
  dotUpcoming: {
    backgroundColor: '#E2E8F0',
  },
  connector: {
    flex: 1,
    height: 2,
    marginHorizontal: 4,
    backgroundColor: '#E2E8F0',
  },
  connectorDone: {
    backgroundColor: '#FFE500',
  },
  connectorActive: {
    backgroundColor: '#FFE500',
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  label: {
    flex: 1,
    textAlign: 'center',
    fontSize: 10,
    lineHeight: 12,
    fontFamily: typography.medium,
    color: '#94A3B8',
  },
  labelActive: {
    color: cargoTheme.colors.primaryDark,
    fontFamily: typography.bold,
  },
  labelDone: {
    color: '#64748B',
  },
  skeletonTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
  },
  skeletonLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  skeletonLabel: {
    flex: 1,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
  },
  wizardWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  wizardItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  wizardDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#E5E7EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  wizardDotActive: {
    backgroundColor: cargoTheme.colors.primary,
  },
  wizardDotDone: {
    backgroundColor: cargoTheme.colors.primaryDark,
  },
  wizardDotText: {
    fontSize: 11,
    lineHeight: 13,
    fontFamily: typography.bold,
    color: '#6B7280',
  },
  wizardDotTextOn: {
    color: '#FFFFFF',
  },
  wizardDotTextActive: {
    color: '#111827',
  },
  wizardLabel: {
    fontSize: 12,
    lineHeight: 15,
    fontFamily: typography.semibold,
    color: '#9CA3AF',
  },
  wizardLabelActive: {
    color: cargoTheme.colors.ink,
  },
  wizardLine: {
    flex: 1,
    height: 2,
    marginLeft: 4,
    backgroundColor: '#E5E7EB',
  },
  wizardLineDone: {
    backgroundColor: cargoTheme.colors.primary,
  },
});
