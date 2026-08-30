// App-wide language state + translation lookup — no external i18n library,
// same dependency-free approach as the rest of this codebase. See
// lib/translations/{en,it}.ts for the actual strings; it.ts is typed
// against en.ts's exact shape, so a missing translation fails to compile
// rather than silently falling back at runtime.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { en } from "@/lib/translations/en";
import { it } from "@/lib/translations/it";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Language = "en" | "it";

const LANGUAGE_KEY = "settings:language";

const translations = { en, it };

type Translations = typeof en;

// Every dotted leaf path into Translations, e.g. "settings.title" or
// "challenges.battere-poi-levare.name" — lets t() reject a key that doesn't
// exist in en.ts's shape at compile time, even though the lookup itself is
// a runtime string split.
type DeepKeyOf<T> = T extends string
  ? never
  : {
      [K in keyof T & string]: T[K] extends string ? K : `${K}.${DeepKeyOf<T[K]>}`;
    }[keyof T & string];

export type TranslationKey = DeepKeyOf<Translations>;

function resolve(dict: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object" && part in node) {
      return (node as Record<string, unknown>)[part];
    }
    return undefined;
  }, dict);
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>("en");

  // Same try/catch-swallow-into-default pattern as lib/onboarding.ts's own
  // AsyncStorage reads — a corrupted/missing value just means "English",
  // never blocks the app from rendering.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(LANGUAGE_KEY)
      .then((value) => {
        if (cancelled) return;
        if (value === "en" || value === "it") setLanguageState(value);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    AsyncStorage.setItem(LANGUAGE_KEY, next);
  };

  const t = useMemo(() => {
    return (key: TranslationKey, vars?: Record<string, string | number>) => {
      const value = resolve(translations[language], key);
      // Defensive fallback only — key is looked up by string at runtime, so
      // this can't be guaranteed by TranslationKey's compile-time check the
      // way it.ts's `typeof en` typing guarantees the dictionaries
      // themselves stay in sync.
      const fallback = resolve(translations.en, key);
      const template = typeof value === "string" ? value : typeof fallback === "string" ? fallback : key;
      return interpolate(template, vars);
    };
  }, [language]);

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useTranslation must be used within a LanguageProvider");
  return ctx;
}
