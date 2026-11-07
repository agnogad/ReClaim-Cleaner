import { useTranslation } from "react-i18next";
import { localeOf } from "../i18n/languages";
import { useApp } from "../store/app";
import { formatBytes } from "./format";
import { hasFeature, type Feature } from "./platform";

/** BCP 47 locale for Intl formatting, following the UI language. */
export function useLocale(): string {
  const { i18n } = useTranslation();
  return localeOf(i18n.language);
}

export function useBytes() {
  const locale = useLocale();
  return (n: number) => formatBytes(n, locale);
}

/** Whether this system has a page, panel or action. */
export function useFeature(feature: Feature): boolean {
  return useApp((s) => hasFeature(s.platform, feature));
}
