import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { de } from "./de";
import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { id } from "./id";
import { it } from "./it";
import { ja } from "./ja";
import { ko } from "./ko";
import { resolveLang, type Lang } from "./languages";
import { pl } from "./pl";
import { pt } from "./pt";
import { ru } from "./ru";
import { tr } from "./tr";
import { uk } from "./uk";
import { zh } from "./zh";

export { resolveLang, type Lang } from "./languages";

export const TRANSLATIONS = { en, tr, de, es, fr, it, pt, pl, ru, uk, id, ja, ko, zh } as const;

function cachedLang(): string | undefined {
  try {
    return localStorage.getItem("reclaim:lang") ?? undefined;
  } catch {
    return undefined;
  }
}

const resources = Object.fromEntries(Object.entries(TRANSLATIONS).map(([code, translation]) => [code, { translation }]));

// Missing keys in a translation fall back to English, so a new feature never shows raw keys.
void i18n.use(initReactI18next).init({
  resources,
  lng: resolveLang(cachedLang()),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
  returnNull: false,
});

type Tree = { [key: string]: string | Tree };

function merge(base: Tree, over: Tree): Tree {
  const out: Tree = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = typeof value === "object" && typeof current === "object" ? merge(current, value) : value;
  }
  return out;
}

/**
 * What a language says off Windows: its own `linux` wording over the English one. Starting from
 * English matters, because a translated Windows string would otherwise win over the fallback.
 */
export function linuxWording(lang: string): Tree {
  const own = (TRANSLATIONS as Record<string, { linux?: unknown }>)[lang]?.linux;
  return merge(en.linux, (own ?? {}) as Tree);
}

/**
 * Pages ask for the same keys on every system; off Windows the strings that name Windows things
 * (Explorer, the Recycle Bin, UAC) are replaced once at startup. Windows is left untouched.
 */
export function applyPlatformWording(platform: string): void {
  if (platform === "windows") return;
  for (const code of Object.keys(TRANSLATIONS)) i18n.addResourceBundle(code, "translation", linuxWording(code), true, true);
}

export function setLanguage(pref: string): Lang {
  const lang = resolveLang(pref);
  try {
    localStorage.setItem("reclaim:lang", pref);
  } catch {
    // Storage can be unavailable; the language still applies for this session.
  }
  // The lang attribute also lets WebView2 pick the right CJK glyph forms.
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
  return lang;
}

export default i18n;
