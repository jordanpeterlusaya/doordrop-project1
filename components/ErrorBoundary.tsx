import type { ErrorBoundaryProps } from 'expo-router';
import { cargoTheme } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { recordCargoDiagnostic } from '@/lib/cargo-diagnostics';
import { logBoundaryError, logError } from '@/lib/debug-logger';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  children: React.ReactNode;
  fallbackMessage?: string;
  onRetry?: () => void;
  screenName?: string;
};

type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    if (this.props.screenName === 'Book cargo') {
      recordCargoDiagnostic('book-cargo:error-boundary:component-did-catch', {
        message: error.message,
      });
    }
    logBoundaryError(this.props.screenName ?? 'ScreenBoundary', error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: undefined });
    this.props.onRetry?.();
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.root}>
          <Text style={styles.eyebrow}>{this.props.screenName ?? 'DoorDrop screen'}</Text>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message ||
              this.props.fallbackMessage ||
              'An unexpected error occurred. Try loading this screen again.'}
          </Text>
          <Pressable style={styles.button} onPress={this.handleRetry}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

export const ScreenErrorBoundary = ErrorBoundary;

export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  React.useEffect(() => {
    if (error.message.toLowerCase().includes('cargo')) {
      recordCargoDiagnostic('book-cargo:route-error-boundary', {
        message: error.message,
      });
    }
    logError('RouteErrorBoundary', 'route-render-failure', error);
  }, [error]);

  return (
    <View style={styles.root}>
      <Text style={styles.eyebrow}>DoorDrop route</Text>
      <Text style={styles.title}>This screen hit an error</Text>
      <Text style={styles.message}>
        {error.message || 'A route failed while loading. Try rendering the screen again.'}
      </Text>
      <Pressable style={styles.button} onPress={retry}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: cargoTheme.colors.canvas,
  },
  eyebrow: {
    color: cargoTheme.colors.primaryDark,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: typography.bold,
    letterSpacing: 0.6,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 20,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: cargoTheme.colors.subtext,
    marginBottom: 16,
    textAlign: 'center',
  },
  button: {
    minHeight: 48,
    minWidth: 150,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: cargoTheme.colors.primary,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: typography.extrabold,
  },
});

export default ErrorBoundary;
