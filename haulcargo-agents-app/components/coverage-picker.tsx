import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  COVERAGE_ALL_TZ,
  COVERAGE_INTERNATIONAL,
  TZ_REGIONS,
  type CoverageSelection,
} from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { Muted } from '@/components/ui';

type Props = {
  value: CoverageSelection;
  onChange: (next: CoverageSelection) => void;
};

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function CoveragePicker({ value, onChange }: Props) {
  const toggleAllTz = () => {
    onChange({
      ...value,
      coverageAllTanzania: !value.coverageAllTanzania,
      coverageRegions: !value.coverageAllTanzania ? [] : value.coverageRegions,
    });
  };

  const toggleIntl = () => {
    onChange({ ...value, coverageInternational: !value.coverageInternational });
  };

  const toggleRegion = (region: string) => {
    if (value.coverageAllTanzania) {
      onChange({
        coverageAllTanzania: false,
        coverageInternational: value.coverageInternational,
        coverageRegions: [region],
      });
      return;
    }
    const has = value.coverageRegions.includes(region);
    onChange({
      ...value,
      coverageRegions: has
        ? value.coverageRegions.filter((item) => item !== region)
        : [...value.coverageRegions, region],
    });
  };

  return (
    <View style={styles.wrap}>
      <Muted style={styles.hint}>
        Chagua maeneo mnayohudumia — HAUL itapeleka oda za mizigo kulingana na coverage hii na njia zenu.
      </Muted>
      <View style={styles.row}>
        <Chip label={COVERAGE_ALL_TZ} selected={value.coverageAllTanzania} onPress={toggleAllTz} />
        <Chip label={COVERAGE_INTERNATIONAL} selected={value.coverageInternational} onPress={toggleIntl} />
      </View>
      {!value.coverageAllTanzania ? (
        <>
          <Text style={styles.section}>Mikoa mahususi</Text>
          <View style={styles.grid}>
            {TZ_REGIONS.map((region) => (
              <Chip
                key={region}
                label={region}
                selected={value.coverageRegions.includes(region)}
                onPress={() => toggleRegion(region)}
              />
            ))}
          </View>
        </>
      ) : (
        <Muted style={styles.hint}>Mikoa yote Tanzania imechaguliwa.</Muted>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  hint: { marginBottom: 12, lineHeight: 20 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  section: {
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 8,
    fontSize: 14,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.white,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  chipSelected: {
    backgroundColor: theme.primary,
    borderColor: theme.ink,
  },
  chipText: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.ink,
  },
  chipTextSelected: {
    fontFamily: typography.semibold,
  },
});
