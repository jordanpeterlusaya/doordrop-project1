import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cancelDeskNotice,
  commissionPayCeiling,
  paywallDeskNotice,
  type DeskNotice,
} from '@/constants/carrier-desk';
import { theme } from '@/constants/theme';
import { typography } from '@/constants/typography';
import { deskStanding, unpaidHaulFee } from '@/lib/desk-standing';
import { useCarrierSession } from '@/providers/carrier-session';

const DISMISS_MS = 4500;

/**
 * Timed desk notices. They show when the app opens and when a new
 * threshold is crossed, then dismiss. They do not stay on Nyumbani.
 */
export function DeskNotices() {
  const { carrier, shipments, decisions } = useCarrierSession();
  const insets = useSafeAreaInsets();
  const carrierId = carrier?.id || '';
  const standing = useMemo(
    () => deskStanding(shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels),
    [shipments, carrierId, decisions, carrier?.rejected, carrier?.postAcceptCancels],
  );
  const unpaid = useMemo(() => (carrierId ? unpaidHaulFee(shipments, carrierId) : 0), [shipments, carrierId]);
  const notices = useMemo(() => {
    if (!carrierId) return [] as DeskNotice[];
    const list: DeskNotice[] = [];
    const cancel = cancelDeskNotice(standing, Boolean(carrier?.offersPaused || carrier?.fraudHold));
    if (cancel) list.push(cancel);
    const paywall = paywallDeskNotice(unpaid, commissionPayCeiling(standing));
    if (paywall) list.push(paywall);
    return list;
  }, [carrierId, standing, carrier?.offersPaused, carrier?.fraudHold, unpaid]);

  const signature = notices.map((item) => item.id).join('|');
  const noticesRef = useRef(notices);
  noticesRef.current = notices;
  const [current, setCurrent] = useState<DeskNotice | null>(null);
  const [foreground, setForeground] = useState(0);
  const queueRef = useRef<DeskNotice[]>([]);
  const shownRef = useRef(new Set<DeskNotice['id']>());
  const showingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const pump = () => {
    if (showingRef.current) return;
    const next = queueRef.current.shift() || null;
    if (!next) {
      setCurrent(null);
      return;
    }
    showingRef.current = true;
    setCurrent(next);
    clearTimer();
    timerRef.current = setTimeout(() => {
      showingRef.current = false;
      setCurrent(null);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pump();
      }, 180);
    }, DISMISS_MS);
  };

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && previous !== 'active') {
        clearTimer();
        showingRef.current = false;
        queueRef.current = [];
        shownRef.current.clear();
        setCurrent(null);
        setForeground((value) => value + 1);
      }
    });
    return () => {
      sub.remove();
      clearTimer();
    };
  }, []);

  useEffect(() => {
    const items = noticesRef.current;
    const live = new Set(items.map((item) => item.id));
    for (const id of [...shownRef.current]) {
      if (!live.has(id)) shownRef.current.delete(id);
    }
    const fresh = items.filter((item) => !shownRef.current.has(item.id));
    if (!fresh.length) return undefined;
    for (const item of fresh) shownRef.current.add(item.id);
    queueRef.current.push(...fresh);
    pump();
    return undefined;
  }, [signature, foreground]);

  if (!current) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 10 }]}>
      <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.toast}>
        <Text style={[styles.text, current.hard && styles.hard]}>{current.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 30,
    elevation: 8,
  },
  toast: {
    borderRadius: 16,
    backgroundColor: theme.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#0B1220',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  text: {
    fontFamily: typography.semibold,
    fontSize: 15,
    lineHeight: 21,
    color: theme.ink,
  },
  hard: {
    color: theme.danger,
  },
});
