import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { WarningSheet } from '@/components/warning-sheet';
import {
  cancelDeskNotice,
  commissionPayCeiling,
  paywallDeskNotice,
  type DeskNotice,
} from '@/constants/carrier-desk';
import { deskStanding, unpaidHaulFee } from '@/lib/desk-standing';
import { useCarrierSession } from '@/providers/carrier-session';

const DISMISS_MS = 5000;

/**
 * Cancel-rate and paywall warnings. One bottom sheet at a time.
 * They show when the app opens and when a threshold is crossed, then close.
 * They are not notifications and they do not stay pinned on Nyumbani.
 */
export function DeskNotices() {
  const { carrier, shipments, decisions } = useCarrierSession();
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
  const appStateRef = useRef(AppState.currentState);
  const displayRef = useRef<DeskNotice | null>(null);
  if (current) displayRef.current = current;

  const pump = () => {
    if (showingRef.current) return;
    const next = queueRef.current.shift() || null;
    if (!next) return;
    showingRef.current = true;
    setCurrent(next);
  };

  const finishCurrent = () => {
    showingRef.current = false;
    const next = queueRef.current.shift() || null;
    if (next) {
      showingRef.current = true;
      setCurrent(next);
      return;
    }
    setCurrent(null);
  };

  useEffect(() => {
    if (!current) return undefined;
    const handle = setTimeout(() => finishCurrent(), DISMISS_MS);
    return () => clearTimeout(handle);
  }, [current]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const previous = appStateRef.current;
      appStateRef.current = next;
      if (next === 'active' && previous !== 'active') {
        showingRef.current = false;
        queueRef.current = [];
        shownRef.current.clear();
        setCurrent(null);
        setForeground((value) => value + 1);
      }
    });
    return () => sub.remove();
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

  if (!carrierId) return null;
  const display = current || displayRef.current;

  return (
    <WarningSheet
      visible={Boolean(current)}
      message={display?.message || ''}
      dismissOnBackdrop
      onDismiss={finishCurrent}
    />
  );
}
