/**
 * Device-driven locale selection.
 *
 * Rule (per product requirement):
 *   - No detectable language preference  → Thai
 *   - Preferred language is Thai          → Thai
 *   - Any other detectable language       → English
 *
 * There is no manual switcher: the choice follows the client device, resolved
 * once at load. Show one language at a time — never both — via `t(th, en)`.
 */
export type Locale = "th" | "en";

const STORAGE_KEY = "skrc-locale";

export function detectLocale(): Locale {
  if (typeof navigator === "undefined") return "th";
  const preferences =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : navigator.language
        ? [navigator.language]
        : [];
  if (preferences.length === 0) return "th"; // unknown → Thai
  // The device's top preference decides: Thai stays Thai, anything else → English.
  return preferences[0].toLowerCase().startsWith("th") ? "th" : "en";
}

function storedLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "th" || value === "en" ? value : null;
  } catch {
    return null;
  }
}

/** Whether the active locale came from a manual choice rather than the device. */
export const localeSource: "manual" | "device" = storedLocale() ? "manual" : "device";

/** The active locale: a manual override if the user chose one, else the device. */
export const locale: Locale = storedLocale() ?? detectLocale();

if (typeof document !== "undefined") {
  document.documentElement.lang = locale;
}

/**
 * Persist a manual language choice and reload so every `t()`/`tt()` call — which
 * read the module-level `locale` — re-resolves. A reload keeps this simple and
 * reliable without threading locale state through hundreds of plain function
 * calls; language switching is a rare, deliberate action.
 */
export function setLocale(next: Locale): void {
  if (next === locale) return;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore storage failures — the switch just won't persist */
  }
  if (typeof location !== "undefined") location.reload();
}

/** Pick the string for the active locale. */
export function t(th: string, en: string): string {
  return locale === "th" ? th : en;
}

/**
 * Resolve a legacy inline-bilingual string ("ไทย / English") to one language.
 * Splits on the first " / " (Thai first, English second) so English text that
 * itself contains " / " stays intact. Falls back to the whole string if there
 * is no separator.
 */
export function tt(bilingual: string): string {
  const sep = bilingual.indexOf(" / ");
  if (sep === -1) return bilingual;
  return locale === "th" ? bilingual.slice(0, sep) : bilingual.slice(sep + 3);
}

/** True when the active locale is Thai — for choosing between JSX branches. */
export const isThai = locale === "th";
