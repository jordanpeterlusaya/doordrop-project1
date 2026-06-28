import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { getPersistedItem, setPersistedItem } from '@/lib/persistent-storage';

export type AppLanguage = 'en' | 'sw';

type LanguageContextValue = {
  language: AppLanguage;
  loading: boolean;
  setLanguage: (nextLanguage: AppLanguage) => Promise<void>;
};

const APP_LANGUAGE_STORAGE_KEY = 'doordrop.app-language';
const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

function isAppLanguage(value: string | null): value is AppLanguage {
  return value === 'en' || value === 'sw';
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>('en');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    void getPersistedItem(APP_LANGUAGE_STORAGE_KEY)
      .then((storedLanguage) => {
        if (!active || !isAppLanguage(storedLanguage)) {
          return;
        }

        setLanguageState(storedLanguage);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      loading,
      setLanguage: async (nextLanguage) => {
        setLanguageState(nextLanguage);
        await setPersistedItem(APP_LANGUAGE_STORAGE_KEY, nextLanguage);
      },
    }),
    [language, loading]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }

  return context;
}
