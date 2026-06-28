import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import {
  getDoorDropApiDebugState,
  subscribeDoorDropApiDebug,
  type DoorDropApiDebugState,
} from '@/lib/api-debug';

type ApiDebugCardProps = {
  style?: ViewStyle;
};

function DebugRow({ label, value, isError = false }: { label: string; value: string; isError?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, isError && styles.valueError]}>{value}</Text>
    </View>
  );
}

export function ApiDebugCard({ style }: ApiDebugCardProps) {
  const [debugState, setDebugState] = useState<DoorDropApiDebugState>(() => getDoorDropApiDebugState());

  useEffect(() => {
    return subscribeDoorDropApiDebug(() => {
      setDebugState(getDoorDropApiDebugState());
    });
  }, []);

  return (
    <View style={[styles.card, style]}>
      <Text style={styles.title}>API diagnostics</Text>

      {debugState.missingEnvMessage ? (
        <Text style={styles.bannerError}>{debugState.missingEnvMessage}</Text>
      ) : null}

      <DebugRow
        label="process.env.EXPO_PUBLIC_API_BASE_URL"
        value={debugState.processEnvApiBaseUrl || 'missing'}
        isError={!debugState.processEnvApiBaseUrl}
      />
      <DebugRow
        label="API_BASE_URL used by app"
        value={debugState.resolvedApiBaseUrl || debugState.missingEnvMessage || 'missing'}
        isError={!debugState.resolvedApiBaseUrl}
      />
      <DebugRow
        label="Last request"
        value={
          debugState.lastRequestUrl
            ? `${debugState.lastRequestMethod || 'GET'} ${debugState.lastRequestUrl}`
            : 'Waiting for request'
        }
      />
      <DebugRow
        label="Last request body"
        value={debugState.lastRequestBody || 'No request body recorded'}
      />
      <DebugRow
        label="Last autocomplete URL"
        value={debugState.lastAutocompleteUrl || 'Waiting for autocomplete request'}
      />
      <DebugRow
        label="Last place resolve URL"
        value={debugState.lastPlaceResolveUrl || 'Waiting for place details/resolve request'}
      />
      <DebugRow
        label="Last route estimate URL"
        value={debugState.lastRoutesUrl || 'Waiting for route estimate request'}
      />
      <DebugRow
        label="Last response status"
        value={
          debugState.lastResponseStatus !== null
            ? `${debugState.lastResponseStatus} (${debugState.lastResponseStatusLabel || 'response'})`
            : debugState.lastResponseStatusLabel || 'Waiting for response'
        }
      />
      <DebugRow
        label="Last response URL"
        value={debugState.lastResponseUrl || 'Waiting for response URL'}
      />
      <DebugRow
        label="Last raw response text"
        value={debugState.lastResponseRawText || 'Waiting for response body'}
      />
      <DebugRow
        label="Last parsed JSON"
        value={debugState.lastParsedResponseBody || 'Waiting for parsed JSON'}
      />
      <DebugRow
        label={debugState.lastErrorMessage ? `Last error (${debugState.lastErrorKind || 'unknown'})` : 'Last response summary'}
        value={debugState.lastErrorMessage || debugState.lastResponseBody || 'Waiting for response summary'}
        isError={Boolean(debugState.lastErrorMessage)}
      />
      {debugState.lastErrorStack ? (
        <DebugRow label="Last error stack" value={debugState.lastErrorStack} isError />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: 22,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEA',
    padding: 14,
    gap: 10,
  },
  title: {
    fontSize: 14,
    fontWeight: '800',
    color: '#7C2D12',
  },
  bannerError: {
    borderRadius: 14,
    backgroundColor: '#FEF2F2',
    color: '#B91C1C',
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
    fontWeight: '700',
  },
  row: {
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#92400E',
    textTransform: 'uppercase',
  },
  value: {
    fontSize: 12,
    lineHeight: 18,
    color: '#1F2937',
  },
  valueError: {
    color: '#B91C1C',
    fontWeight: '700',
  },
});
