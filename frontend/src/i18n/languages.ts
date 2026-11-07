/** UI languages, in the order the picker shows them. `locale` drives number and date formats. */
export const LANGUAGES = [
  { code: "en", name: "English", locale: "en-US" },
  { code: "tr", name: "Türkçe", locale: "tr-TR" },
  { code: "de", name: "Deutsch", locale: "de-DE" },
  { code: "es", name: "Español", locale: "es-ES" },
  { code: "fr", name: "Français", locale: "fr-FR" },
  { code: "it", name: "Italiano", locale: "it-IT" },
  { code: "pt", name: "Português (Brasil)", locale: "pt-BR" },
  { code: "pl", name: "Polski", locale: "pl-PL" },
  { code: "ru", name: "Русский", locale: "ru-RU" },
  { code: "uk", name: "Українська", locale: "uk-UA" },
  { code: "id", name: "Bahasa Indonesia", locale: "id-ID" },
  { code: "ja", name: "日本語", locale: "ja-JP" },
  { code: "ko", name: "한국어", locale: "ko-KR" },
  { code: "zh", name: "简体中文", locale: "zh-CN" },
] as const;

export type Lang = (typeof LANGUAGES)[number]["code"];

export function isLang(code: string): code is Lang {
  return LANGUAGES.some((l) => l.code === code);
}

/** Picks the UI language: an explicit setting, else the system language, else English. */
export function resolveLang(pref: string | undefined, system = typeof navigator !== "undefined" ? navigator.language : "en"): Lang {
  if (pref && isLang(pref)) return pref;
  const base = system.toLowerCase().split("-")[0] ?? "en";
  return isLang(base) ? base : "en";
}

export function localeOf(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.locale ?? "en-US";
}
