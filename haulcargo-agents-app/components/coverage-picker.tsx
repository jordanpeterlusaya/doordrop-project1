import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TZ_REGIONS, type CoverageSelection } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

type Props = {
  value: CoverageSelection;
  onChange: (next: CoverageSelection) => void;
  /** Company base region, used only for the intra-city explanation. */
  baseRegion?: string;
};

type CoverageMode = 'all' | 'regions' | 'city';

const MODES: { id: CoverageMode; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'regions', label: 'Regions' },
  { id: 'city', label: 'Intra-city' },
];

export function CoveragePicker({ value, onChange, baseRegion }: Props) {
  const [query, setQuery] = useState('');
  const [pickedMode, setPickedMode] = useState<CoverageMode | null>(null);

  const mode: CoverageMode | null =
    pickedMode ??
    (value.coverageIntraCity ? 'city' : value.coverageAllTanzania ? 'all' : value.coverageRegions.length ? 'regions' : null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...TZ_REGIONS];
    return TZ_REGIONS.filter((region) => region.toLowerCase().includes(q));
  }, [query]);

  const selectMode = (nextMode: CoverageMode) => {
    setPickedMode(nextMode);
    if (nextMode === 'all') {
      onChange({
        ...value,
        coverageAllTanzania: true,
        coverageIntraCity: false,
        coverageRegions: [],
        coverageInternational: false,
        coverageInternationalCountries: '',
      });
      return;
    }
    if (nextMode === 'city') {
      onChange({
        ...value,
        coverageAllTanzania: false,
        coverageIntraCity: true,
        coverageRegions: [],
        coverageInternational: false,
        coverageInternationalCountries: '',
      });
      return;
    }
    onChange({
      ...value,
      coverageAllTanzania: false,
      coverageIntraCity: false,
      coverageInternational: false,
      coverageInternationalCountries: '',
    });
  };

  const toggleRegion = (region: string) => {
    setPickedMode('regions');
    const base = value.coverageAllTanzania || value.coverageIntraCity ? [] : value.coverageRegions;
    const has = base.includes(region);
    onChange({
      ...value,
      coverageAllTanzania: false,
      coverageIntraCity: false,
      coverageInternational: false,
      coverageInternationalCountries: '',
      coverageRegions: has ? base.filter((item) => item !== region) : [...base, region],
    });
  };

  const cityLabel = baseRegion?.trim() || 'your base region';
  const hint =
    mode === 'city'
      ? `Pickup and delivery stay in ${cityLabel}.`
      : mode === 'all'
        ? 'Any destination. Pickup stays in your base region.'
        : mode === 'regions'
          ? 'Choose the destination regions you serve.'
          : 'All Tanzania, selected regions, or intra-city only.';

  return (
    <View style={styles.wrap}>
      <View style={styles.segment} accessibilityRole="tablist">
        {MODES.map((item) => {
          const selected = mode === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => selectMode(item.id)}
              style={[styles.segmentBtn, selected && styles.segmentBtnOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected }}>
              <Text style={[styles.segmentText, selected && styles.segmentTextOn]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>{hint}</Text>

      {mode === 'regions' ? (
        <>
          <View style={styles.searchMeta}>
            <Text style={styles.count}>
              {value.coverageRegions.length === 0
                ? 'None selected'
                : `${value.coverageRegions.length} selected`}
            </Text>
            {value.coverageRegions.length > 0 ? (
              <Pressable
                onPress={() =>
                  onChange({
                    ...value,
                    coverageRegions: [],
                    coverageAllTanzania: false,
                    coverageIntraCity: false,
                  })
                }
                hitSlop={8}
                accessibilityRole="button">
                <Text style={styles.clear}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.searchWrap}>
            <Ionicons name="search-outline" size={18} color={theme.muted} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search regions"
              placeholderTextColor={theme.muted}
              style={styles.searchInput}
              autoCorrect={false}
              autoCapitalize="words"
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={theme.muted} />
              </Pressable>
            ) : null}
          </View>
          <View style={styles.list}>
            {filtered.map((region, index) => {
              const selected = value.coverageRegions.includes(region);
              return (
                <Pressable
                  key={region}
                  onPress={() => toggleRegion(region)}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowBorder,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected }}>
                  <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]} numberOfLines={1}>
                    {region}
                  </Text>
                  <View style={[styles.check, selected && styles.checkOn]}>
                    {selected ? <Ionicons name="checkmark" size={14} color={theme.white} /> : null}
                  </View>
                </Pressable>
              );
            })}
            {filtered.length === 0 ? (
              <Text style={styles.empty}>No region matches “{query.trim()}”.</Text>
            ) : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  segment: {
    flexDirection: 'row',
    backgroundColor: theme.primarySoft,
    borderRadius: 10,
    padding: 3,
    marginBottom: 10,
  },
  segmentBtn: {
    flex: 1,
    minHeight: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  segmentBtnOn: { backgroundColor: '#000000' },
  segmentText: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
  },
  segmentTextOn: { color: theme.white },
  hint: {
    fontFamily: typography.body,
    fontSize: 13,
    lineHeight: 18,
    color: theme.muted,
    marginBottom: 12,
  },
  searchMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  count: {
    fontFamily: typography.body,
    fontSize: 12,
    color: theme.muted,
  },
  clear: {
    fontFamily: typography.semibold,
    fontSize: 13,
    color: theme.ink,
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
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 15,
    color: theme.ink,
    paddingVertical: 10,
  },
  list: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.white,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
    backgroundColor: theme.white,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
  },
  rowPressed: { backgroundColor: theme.primarySoft },
  rowLabel: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 15,
    color: theme.ink,
  },
  rowLabelSelected: { fontFamily: typography.semibold },
  check: {
    width: 20,
    height: 20,
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
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
});
