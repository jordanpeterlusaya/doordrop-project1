import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import {
    SafeAreaView,
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

import { bottomTabs, cargoTheme, type AppTabKey, type CargoIcon } from '@/constants/cargo-theme';
import { typography } from '@/constants/typography';

type CargoScreenProps = {
  children: React.ReactNode;
  scroll?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  backgroundColor?: string;
  footer?: React.ReactNode;
  statusBarStyle?: 'light-content' | 'dark-content';
  keyboardAvoiding?: boolean;
  keyboardVerticalOffset?: number;
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
}: CargoScreenProps) {
  const shouldUseKeyboardAvoiding = keyboardAvoiding && Platform.OS === 'ios';
  const body = (
    <>
      {scroll ? (
        <ScrollView
          style={[styles.screen, { backgroundColor }]}
          contentContainerStyle={[styles.content, contentContainerStyle]}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.screen, styles.content, { backgroundColor }, contentContainerStyle]}>
          {children}
        </View>
      )}
      {footer}
    </>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor }]}>
      <StatusBar barStyle={statusBarStyle} backgroundColor="transparent" translucent />
      {shouldUseKeyboardAvoiding ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardVerticalOffset}
          style={styles.keyboardAvoiding}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
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

export function PrimaryButton({ label, onPress, icon, variant = 'primary', style, disabled = false }: ButtonProps) {
  const handlePress = useGuardedPress(onPress, disabled || !onPress);
  const variantStyles = {
    primary: {
      backgroundColor: cargoTheme.colors.primary,
      color: '#FFFFFF',
      borderColor: cargoTheme.colors.primary,
    },
    secondary: {
      backgroundColor: cargoTheme.colors.surface,
      color: cargoTheme.colors.text,
      borderColor: cargoTheme.colors.line,
    },
    dark: {
      backgroundColor: cargoTheme.colors.darkSurface,
      color: '#FFFFFF',
      borderColor: cargoTheme.colors.darkSurface,
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
        {
          backgroundColor: variantStyles.backgroundColor,
          borderColor: variantStyles.borderColor,
        },
        disabled && styles.buttonDisabled,
        style,
      ]}>
      <View style={styles.buttonInner}>
        <Text style={[styles.buttonText, { color: variantStyles.color }]}>{label}</Text>
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

export function BottomNav({ activeTab }: { activeTab: AppTabKey }) {
  const router = useRouter();
  const lastNavPressRef = useRef(0);

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

  return (
    <View style={styles.bottomNav}>
      {bottomTabs.map((tab) => {
        const isActive = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            activeOpacity={0.88}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive, disabled: isActive }}
            disabled={isActive}
            style={styles.navItem}
            onPress={() => handleTabPress(tab)}>
            <View style={[styles.navIconWrap, isActive && styles.navIconWrapActive]}>
              <MaterialCommunityIcons
                name={tab.icon}
                size={22}
                color={isActive ? cargoTheme.colors.primaryDark : '#94A3B8'}
              />
            </View>
            <Text style={[styles.navLabel, isActive && styles.navLabelActive]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
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
  header: {
    paddingTop: 8,
    marginBottom: 20,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  headerButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSpacer: {
    width: 46,
    height: 46,
  },
  headerTitle: {
    fontSize: 28,
    lineHeight: 34,
    fontFamily: typography.extrabold,
  },
  headerSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 21,
  },
  button: {
    minHeight: 56,
    borderRadius: 18,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
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
    fontSize: 16,
    fontFamily: typography.extrabold,
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
    color: cargoTheme.colors.primary,
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
  bottomNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#EAF0F6',
    backgroundColor: cargoTheme.colors.surface,
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
  },
  navIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navIconWrapActive: {
    backgroundColor: '#ECFDF3',
  },
  navLabel: {
    fontSize: 12,
    fontFamily: typography.bold,
    color: '#94A3B8',
  },
  navLabelActive: {
    color: cargoTheme.colors.primaryDark,
  },
});
