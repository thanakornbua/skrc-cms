import { locale, setLocale, type Locale } from "../i18n";

const OPTIONS: Array<{ code: Locale; label: string }> = [
  { code: "th", label: "ไทย" },
  { code: "en", label: "EN" },
];

/** Segmented TH/EN control. Persists the choice and reloads so the whole app
 *  re-resolves to the selected language. */
export default function LanguageToggle() {
  return (
    <div className="lang-toggle" role="group" aria-label="Language / ภาษา">
      {OPTIONS.map((option) => (
        <button
          key={option.code}
          type="button"
          lang={option.code}
          aria-pressed={locale === option.code}
          onClick={() => setLocale(option.code)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
