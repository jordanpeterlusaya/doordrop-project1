import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  COVERAGE_ALL_TZ,
  COVERAGE_INTERNATIONAL,
  TZ_REGIONS,
  coverageSummary,
  type CoverageSelection,
} from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { Field, Muted } from '@/components/ui';

type Props = {
  value: CoverageSelection;
  onChange: (next: CoverageSelection) => void;
  /** Compact embed (e.g. legacy screens). Default shows search + clear selected. */
  compact?: boolean;
};

function Row({
  label,
  selected,
  onPress,
  leading,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  leading?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}>
      <View style={styles.rowLeft}>
        {leading}
        <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Ionicons name="checkmark" size={14} color={theme.white} /> : null}
      </View>
    </Pressable>
  );
}

export function CoveragePicker({ value, onChange, compact = false }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...TZ_REGIONS];
    return TZ_REGIONS.filter((region) => region.toLowerCase().includes(q));
  }, [query]);

  const selectedCount = value.coverageAllTanzania
    ? TZ_REGIONS.length
    : value.coverageRegions.length;
  const summary = coverageSummary(value);

  const toggleAllTz = () => {
    const next = !value.coverageAllTanzania;
    onChange({
      ...value,
      coverageAllTanzania: next,
      coverageRegions: next ? [] : value.coverageRegions,
    });
  };

  const toggleIntl = () => {
    const next = !value.coverageInternational;
    onChange({
      ...value,
      coverageInternational: next,
      coverageInternationalCountries: next ? value.coverageInternationalCountries : '',
    });
  };

  const toggleRegion = (region: string) => {
    if (value.coverageAllTanzania) {
      onChange({
        ...value,
        coverageAllTanzania: false,
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

  const clearSelection = () => {
    onChange({
      coverageRegions: [],
      coverageAllTanzania: false,
      coverageInternational: false,
      coverageInternationalCountries: '',
    });
    setQuery('');
  };

  return (
    <View style={styles.wrap}>
      {!compact ? (
        <View style={styles.summaryCard}>
          <View style={styles.summaryTop}>
            <Text style={styles.summaryLabel}>Imechaguliwa</Text>
            {selectedCount > 0 || value.coverageInternational ? (
              <Pressable onPress={clearSelection} hitSlop={8} accessibilityRole="button">
                <Text style={styles.clearBtn}>Futa</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.summaryValue} numberOfLines={3}>
            {summary}
          </Text>
          {value.coverageAllTanzania ? (
            <Text style={styles.summaryMeta}>Mikoa yote Tanzania ({TZ_REGIONS.length})</Text>
          ) : selectedCount > 0 ? (
            <Text style={styles.summaryMeta}>
              {selectedCount} mkoa{selectedCount === 1 ? '' : ''}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Muted style={styles.hint}>
        Tafuta na chagua mikoa, au chagua mikoa yote. Coverage hutumika kwa matching ya oda.
      </Muted>

      <Row
        label={COVERAGE_ALL_TZ}
        selected={value.coverageAllTanzania}
        onPress={toggleAllTz}
        leading={<Ionicons name="globe-outline" size={18} color={value.coverageAllTanzania ? theme.ink : theme.muted} />}
      />
      <Row
        label={COVERAGE_INTERNATIONAL}
        selected={value.coverageInternational}
        onPress={toggleIntl}
        leading={
          <Ionicons
            name="airplane-outline"
            size={18}
            color={value.coverageInternational ? theme.ink : theme.muted}
          />
        }
      />

      {value.coverageInternational ? (
        <Field
          label="Nchi (nje ya Tanzania)"
          placeholder="Kenya, Uganda, …"
          value={value.coverageInternationalCountries}
          onChangeText={(text) => onChange({ ...value, coverageInternationalCountries: text })}
        />
      ) : null}

      {!value.coverageAllTanzania ? (
        <>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={18} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Tafuta mkoa…"
              placeholderTextColor={theme.muted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="words"
              clearButtonMode="while-editing"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={theme.muted} />
              </Pressable>
            ) : null}
          </View>

          <Text style={styles.section}>Mikoa ({filtered.length})</Text>
          <View style={styles.list}>
            {filtered.map((region) => (
              <Row
                key={region}
                label={region}
                selected={value.coverageRegions.includes(region)}
                onPress={() => toggleRegion(region)}
              />
            ))}
            {filtered.length === 0 ? (
              <Text style={styles.empty}>Hakuna mkoa unaolingana na “{query.trim()}”.</Text>
            ) : null}
          </View>
        </>
      ) : (
        <Muted style={styles.hint}>Mikoa yote Tanzania imechaguliwa — oda zote ndani ya nchi zinaweza kulingana.</Muted>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  hint: { marginBottom: 12, lineHeight: 20 },
  summaryCard: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.tile,
    padding: 14,
    marginBottom: 14,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  summaryLabel: {
    fontFamily: typography.semibold,
    fontSize: 12,
    color: theme.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  clearBtn: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  summaryValue: {
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
  },
  summaryMeta: {
    marginTop: 6,
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.white,
    paddingHorizontal: 12,
    minHeight: 46,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 15,
    color: theme.ink,
    paddingVertical: 10,
  },
  section: {
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 8,
    fontSize: 14,
  },
  list: { gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.white,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: theme.radius.md,
    marginBottom: 6,
    gap: 10,
  },
  rowSelected: {
    borderColor: theme.ink,
    backgroundColor: theme.primarySoft,
  },
  rowPressed: { opacity: 0.92 },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 14,
    color: theme.ink,
  },
  rowLabelSelected: { fontFamily: typography.semibold },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.white,
  },
  checkOn: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  empty: {
    fontFamily: typography.body,
    fontSize: 13,
    color: theme.muted,
    paddingVertical: 12,
  },
});
