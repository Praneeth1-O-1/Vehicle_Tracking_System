import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import en from './en.json';
import ta from './ta.json';
import hi from './hi.json';

// ─── Types ───────────────────────────────────────────────
export type LanguageCode = 'en' | 'ta' | 'hi';

export interface LanguageOption {
    code: LanguageCode;
    label: string;       // Native name shown in dropdown
}

export const LANGUAGES: LanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'ta', label: 'தமிழ்' },
    { code: 'hi', label: 'हिन्दी' },
];

const translations: Record<LanguageCode, any> = { en, ta, hi };

const STORAGE_KEY = '@vht_language';

// ─── Context ─────────────────────────────────────────────
interface LanguageContextType {
    language: LanguageCode;
    setLanguage: (lang: LanguageCode) => void;
    t: (key: string, params?: Record<string, string>) => string;
}

const LanguageContext = createContext<LanguageContextType>({
    language: 'en',
    setLanguage: () => {},
    t: (key: string) => key,
});

// ─── Helper: deep get by dotted key ──────────────────────
const getNestedValue = (obj: any, path: string): string | undefined => {
    const keys = path.split('.');
    let current = obj;
    for (const k of keys) {
        if (current === undefined || current === null) return undefined;
        current = current[k];
    }
    return typeof current === 'string' ? current : undefined;
};

// ─── Provider ────────────────────────────────────────────
export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [language, setLanguageState] = useState<LanguageCode>('en');
    const [loaded, setLoaded] = useState(false);

    // Load persisted language on mount
    useEffect(() => {
        (async () => {
            try {
                const saved = await AsyncStorage.getItem(STORAGE_KEY);
                if (saved && (saved === 'en' || saved === 'ta' || saved === 'hi')) {
                    setLanguageState(saved as LanguageCode);
                }
            } catch {
                // Silently default to English
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const setLanguage = useCallback((lang: LanguageCode) => {
        setLanguageState(lang);
        AsyncStorage.setItem(STORAGE_KEY, lang).catch(() => {});
    }, []);

    const t = useCallback((key: string, params?: Record<string, string>): string => {
        let value = getNestedValue(translations[language], key);
        // Fallback to English if key is missing in current language
        if (value === undefined) {
            value = getNestedValue(translations.en, key);
        }
        // Still missing? Return the key itself
        if (value === undefined) return key;

        // Replace template params like {{jobId}}
        if (params) {
            Object.keys(params).forEach((paramKey) => {
                value = value!.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), params[paramKey]);
            });
        }

        return value;
    }, [language]);

    // Don't render children until language is loaded from storage
    if (!loaded) return null;

    return (
        <LanguageContext.Provider value={{ language, setLanguage, t }}>
            {children}
        </LanguageContext.Provider>
    );
};

// ─── Hook ────────────────────────────────────────────────
export const useTranslation = () => useContext(LanguageContext);
