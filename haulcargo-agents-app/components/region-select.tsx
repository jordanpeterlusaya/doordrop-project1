import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TZ_REGIONS } from '@/constants/coverage';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';

type Props = {
  value: string;
  onChange: (region: string) => void;
  error?: string;
};

export function RegionSelect({ value, onChange, error }: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [...TZ_REGIONS];
    return TZ_REGIONS.filter((region) => region.toLowerCase().includes(q));
  }, [query]);

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Base region</Text>
      <Text style={styles.hint}>Where the company is located. Orders are picked up here.</Text>
      <View style={[styles.searchWrap, error ? styles.searchError : null]}>
        <Ionicons name="search-outline" size={18} color={theme.muted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={value || 'Search regions'}
          placeholderTextColor={value && !query ? theme.ink : theme.muted}
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
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {value && !query.trim() ? (
        <View style={styles.selectedRow}>
          <Text style={styles.rowLabelSelected} numberOfLines={1}>
            {value}
          </Text>
          <View style={[styles.check, styles.checkOn]}>
            <Ionicons name="checkmark" size={14} color={theme.white} />
          </View>
        </View>
      ) : (
      <View style={styles.list}>
        {filtered.map((region, index) => {
          const selected = value === region;
          return (
            <Pressable
              key={region}
              onPress={() => {
                onChange(region);
                setQuery('');
              }}
              style={({ pressed }) => [
                styles.row,
                index > 0 && styles.rowBorder,
                pressed && styles.rowPressed,
              ]}
              accessibilityRole="radio"
              accessibilityState={{ selected }}>
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
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 16 },
  label: {
    fontSize: 13,
    fontFamily: typography.semibold,
    color: theme.ink,
    marginBottom: 4,
  },
  hint: {
    fontFamily: typography.body,
    fontSize: 12,
    lineHeight: 17,
    color: theme.muted,
    marginBottom: 8,
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
  searchError: { borderColor: theme.danger },
  searchInput: {
    flex: 1,
    fontFamily: typography.body,
    fontSize: 15,
    color: theme.ink,
    paddingVertical: 10,
  },
  error: {
    marginBottom: 8,
    fontSize: 12,
    fontFamily: typography.semibold,
    color: theme.danger,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.ink,
    borderRadius: theme.radius.md,
    backgroundColor: theme.white,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 12,
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
    borderRadius: 10,
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
