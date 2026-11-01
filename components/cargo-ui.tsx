import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ScrollView,
    StatusBar,
    KeyboardAvoidingView,
    Platform,
    StyleProp,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { bottomTabs, cargoTheme, type AppTabKey, type CargoIcon } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';
import { isHistoryActivityOrder } from '@/lib/active-order-display';
import { useAppCopy } from '@/lib/app-copy';
import { subscribeToUserOrders } from '@/lib/delivery-data';
import { useAuthSession } from '@/providers/auth-provider';

type CargoScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  footer?: React.ReactNode;
  statusBarStyle?: 'light-content' | 'dark-content';
  keyboardAvoiding?: boolean;
  keyboardVerticalOffset?: number;
  scrollRef?: React.RefObject<ScrollView | null>;
};

type CargoHeaderProps = {
  title: string;
  subtitle?: string;
  leftAction?: 'back' | 'menu' | 'close' | 'none';
  onLeftPress?: () => void;
  rightIcon?: CargoIcon;
  onRightPress?: () => void;
  light?: boolean;
};

type ButtonProps = {
  label: string;
  onPress?: () => void;
  icon?: CargoIcon;
  variant?: 'primary' | 'secondary' | 'dark';
  /** `parcel` = original send-parcel CTA (56 / 18 / 16), not tickets 56pt pills. */
  size?: 'default' | 'parcel';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
};

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  onActionPress?: () => void;
};

type MenuRowProps = {
  icon: CargoIcon;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  trailingLabel?: string;
};

type SummaryRowProps = {
  label: string;
  value: string;
  emphasis?: boolean;
};

const leftIconMap = {
  back: 'arrow-left',
  menu: 'menu',
  close: 'close',
} as const;
const PRESS_GUARD_MS = 650;

function useGuardedPress(onPress?: () => void, disabled = false) {
  const lastPressRef = useRef(0);

  return useCallback(() => {
    if (disabled || !onPress) {
      return;
    }

    const now = Date.now();
    if (now - lastPressRef.current < PRESS_GUARD_MS) {
      return;
    }

    lastPressRef.current = now;
    onPress();
  }, [disabled, onPress]);
}

export function CargoScreen({
  children,
  scroll = true,
  contentContainerStyle,
  backgroundColor = cargoTheme.colors.canvas,
  footer,
  statusBarStyle = 'dark-content',
  keyboardAvoiding = false,
  keyboardVerticalOffset = 0,
  scrollRef,
}: CargoScreenProps) {
  const insets = useSafeAreaInsets();
  const isTransparentChrome = backgroundColor === 'transparent';

  const scrollBody = scroll ? (
    <ScrollView
      ref={scrollRef}
      style={[styles.screen, { backgroundColor }]}
      contentContainerStyle={[styles.content, contentContainerStyle]}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.screen, styles.content, { backgroundColor }, contentContainerStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.safeArea, { backgroundColor }]}>
      <StatusBar
        barStyle={statusBarStyle}
        backgroundColor={isTransparentChrome ? 'transparent' : backgroundColor}
        translucent={isTransparentChrome}
      />
      {keyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={styles.keyboardAvoiding}>
          {scrollBody}
        </KeyboardAvoidingView>
      ) : (
        scrollBody
      )}
      {footer ? (
        <View
          style={[
            styles.footerSafe,
            { paddingBottom: Math.max(insets.bottom, Platform.OS === 'android' ? 12 : 8) },
          ]}>
          {footer}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export function CargoHeader({
  title,
  subtitle,
  leftAction = 'back',
  onLeftPress,
  rightIcon,
  onRightPress,
  light = false,
}: CargoHeaderProps) {
  const titleColor = light ? '#FFFFFF' : cargoTheme.colors.text;
  const subtitleColor = light ? '#DCE3EC' : cargoTheme.colors.subtext;
  const chromeBg = light ? 'rgba(255,255,255,0.12)' : cargoTheme.colors.surface;
  const chromeIcon = light ? '#FFFFFF' : cargoTheme.colors.text;
  const handleLeftPress = useGuardedPress(onLeftPress);
  const handleRightPress = useGuardedPress(onRightPress);

  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {leftAction === 'none' ? (
          <View style={styles.headerSpacer} />
        ) : (
          <TouchableOpacity style={[styles.headerButton, { backgroundColor: chromeBg }]} onPress={handleLeftPress}>
            <MaterialCommunityIcons name={leftIconMap[leftAction]} size={22} color={chromeIcon} />
          </TouchableOpacity>
        )}

        {rightIcon ? (
          <TouchableOpacity style={[styles.headerButton, { backgroundColor: chromeBg }]} onPress={handleRightPress}>
            <MaterialCommunityIcons name={rightIcon} size={22} color={chromeIcon} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <Text style={[styles.headerTitle, { color: titleColor }]}>{title}</Text>
      {subtitle ? <Text style={[styles.headerSubtitle, { color: subtitleColor }]}>{subtitle}</Text> : null}
    </View>
  );
}

export const primaryCtaStyles = StyleSheet.create({
  button: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    backgroundColor: cargoTheme.cta.backgroundColor,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  label: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    color: cargoTheme.cta.labelColor,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
});

export function PrimaryButton({
  label,
  onPress,
  icon,
  variant = 'primary',
  size = 'default',
  style,
  disabled = false,
}: ButtonProps) {
  const handlePress = useGuardedPress(onPress, disabled || !onPress);
  const compact = size === 'parcel';
  const variantStyles = {
    primary: {
      backgroundColor: cargoTheme.cta.backgroundColor,
      color: cargoTheme.cta.labelColor,
      borderColor: cargoTheme.cta.backgroundColor,
    },
    secondary: {
      backgroundColor: cargoTheme.colors.surface,
      color: cargoTheme.colors.text,
      borderColor: cargoTheme.colors.line,
    },
    dark: {
      backgroundColor: cargoTheme.cta.backgroundColor,
      color: cargoTheme.cta.labelColor,
      borderColor: cargoTheme.cta.backgroundColor,
    },
  }[variant];

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled || !onPress}
      onPress={handlePress}
      style={[
        styles.button,
        compact && styles.buttonParcel,
        {
          backgroundColor: variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
        },
        disabled && styles.buttonDisabled,
        style,
      ]}>
      <View style={styles.buttonInner}>
        <Text style={[styles.buttonText, compact && styles.buttonTextParcel, { color: variantStyles.color }]}>
          {label}
        </Text>
        {icon ? <MaterialCommunityIcons name={icon} size={20} color={variantStyles.color} /> : null}
      </View>
    </TouchableOpacity>
  );
}

export function SectionHeader({ title, actionLabel, onActionPress }: SectionHeaderProps) {
  const handleActionPress = useGuardedPress(onActionPress, !onActionPress);

  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {actionLabel ? (
        <TouchableOpacity onPress={handleActionPress}>
          <Text style={styles.sectionAction}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function MenuRow({ icon, title, subtitle, onPress, trailingLabel }: MenuRowProps) {
  const handlePress = useGuardedPress(onPress, !onPress);

  return (
    <TouchableOpacity
      style={styles.menuRow}
      onPress={handlePress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !onPress }}
      activeOpacity={0.88}>
      <View style={styles.menuLeading}>
        <View style={styles.menuIconWrap}>
          <MaterialCommunityIcons name={icon} size={20} color={cargoTheme.colors.text} />
        </View>
        <View style={styles.menuCopy}>
          <Text style={styles.menuTitle}>{title}</Text>
          {subtitle ? <Text style={styles.menuSubtitle}>{subtitle}</Text> : null}
        </View>
      </View>

      {trailingLabel ? <Text style={styles.menuTrailing}>{trailingLabel}</Text> : null}
      <MaterialCommunityIcons name="chevron-right" size={20} color="#94A3B8" />
    </TouchableOpacity>
  );
}

export function SummaryRow({ label, value, emphasis = false }: SummaryRowProps) {
  return (
    <View style={styles.summaryRow}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, emphasis && styles.summaryValueStrong]}>{value}</Text>
    </View>
  );
}

export function BottomNav({
  activeTab,
  embedInSafeFooter = false,
}: {
  activeTab?: AppTabKey;
  /** When true, parent already pads for the home indicator (CargoScreen footer). */
  embedInSafeFooter?: boolean;
}) {
  const router = useRouter();
  const copy = useAppCopy();
  const insets = useSafeAreaInsets();
  const { user } = useAuthSession();
  const lastNavPressRef = useRef(0);
  const [historyActivity, setHistoryActivity] = useState(false);
  const tabLabels = {
    home: copy.nav.home,
    history: copy.nav.history,
    account: copy.nav.account,
  };

  const tabIcons = {
    home: { idle: 'home-outline', active: 'home' },
    history: { idle: 'time-outline', active: 'time' },
    account: { idle: 'person-outline', active: 'person' },
  } as const;

  useEffect(() => {
    if (!user?.uid) {
      setHistoryActivity(false);
      return;
    }

    return subscribeToUserOrders(
      user.uid,
      (orders) => {
        setHistoryActivity(orders.some((order) => isHistoryActivityOrder(order)));
      },
      () => {
        setHistoryActivity(false);
      }
    );
  }, [user?.uid]);

  const handleTabPress = useCallback(
    (tab: (typeof bottomTabs)[number]) => {
      if (tab.key === activeTab) {
        return;
      }

      const now = Date.now();
      if (now - lastNavPressRef.current < PRESS_GUARD_MS) {
        return;
      }

      lastNavPressRef.current = now;
      router.push(tab.route);
    },
    [activeTab, router]
  );

  const bottomPad = embedInSafeFooter
    ? 8
    : Math.max(insets.bottom, Platform.OS === 'android' ? 10 : 6);

  return (
    <View style={[styles.navRoot, { paddingBottom: bottomPad }]}>
      <View style={styles.bottomNav}>
        {bottomTabs.map((tab) => {
          const isActive = tab.key === activeTab;
          const showHistoryDot = tab.key === 'history' && historyActivity && !isActive;
          return (
            <TouchableOpacity
              key={tab.key}
              activeOpacity={0.88}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive, disabled: isActive }}
              accessibilityLabel={
                showHistoryDot ? `${tabLabels[tab.key]}, activity in progress` : tabLabels[tab.key]
              }
              disabled={isActive}
              style={styles.navItem}
              onPress={() => handleTabPress(tab)}>
              <View>
                <Ionicons
                  name={isActive ? tabIcons[tab.key].active : tabIcons[tab.key].idle}
                  size={24}
                  color={isActive ? '#111827' : '#9CA3AF'}
                />
                {showHistoryDot ? <View style={styles.navActivityDot} /> : null}
              </View>
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{tabLabels[tab.key]}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  keyboardAvoiding: {
    flex: 1,
  },
  screen: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 24,
  },
  footerSafe: {
    backgroundColor: cargoTheme.colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#EAF0F6',
  },
  header: {
    paddingTop: 4,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 40,
    height: 40,
  },
  headerTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontFamily: typography.extrabold,
  },
  headerSubtitle: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
  },
  button: {
    minHeight: cargoTheme.cta.minHeight,
    borderRadius: cargoTheme.cta.borderRadius,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: cargoTheme.cta.paddingHorizontal,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonInner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  buttonText: {
    fontSize: cargoTheme.cta.labelSize,
    lineHeight: cargoTheme.cta.labelLineHeight,
    fontFamily: typography.bold,
    letterSpacing: cargoTheme.cta.letterSpacing,
  },
  buttonParcel: {
    minHeight: cargoTheme.ctaParcel.minHeight,
    borderRadius: cargoTheme.ctaParcel.borderRadius,
    paddingHorizontal: cargoTheme.ctaParcel.paddingHorizontal,
  },
  buttonTextParcel: {
    fontSize: cargoTheme.ctaParcel.labelSize,
    lineHeight: cargoTheme.ctaParcel.labelLineHeight,
    fontFamily: typography.extrabold,
    letterSpacing: cargoTheme.ctaParcel.letterSpacing,
  },
  sectionHeader: {
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
  },
  sectionAction: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: cargoTheme.colors.ink,
  },
  menuRow: {
    backgroundColor: cargoTheme.colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#EDF2F7',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  menuLeading: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 12,
  },
  menuIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  menuCopy: {
    flex: 1,
  },
  menuTitle: {
    fontSize: 15,
    fontFamily: typography.extrabold,
    color: cargoTheme.colors.text,
    marginBottom: 3,
  },
  menuSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    color: cargoTheme.colors.subtext,
  },
  menuTrailing: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: cargoTheme.colors.primaryDark,
    marginRight: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 13,
    fontFamily: typography.bold,
    color: cargoTheme.colors.subtext,
  },
  summaryValue: {
    fontSize: 14,
    fontFamily: typography.bold,
    color: cargoTheme.colors.text,
  },
  summaryValueStrong: {
    fontSize: 17,
    fontFamily: typography.extrabold,
  },
  navRoot: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
    width: '100%',
    paddingTop: 10,
    paddingHorizontal: 4,
    backgroundColor: '#FFFFFF',
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    minHeight: 48,
    paddingBottom: 2,
  },
  navActivityDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: cargoTheme.colors.primary,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  navLabel: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: typography.medium,
    color: '#9CA3AF',
  },
  navLabelActive: {
    color: '#111827',
    fontFamily: typography.semibold,
  },
});
