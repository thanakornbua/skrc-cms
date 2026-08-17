/**
 * Competitor numbers are minted as `C-0042` (see the counter in
 * backend/src/regweek/repo.ts), and that exact form is what the printed QR and
 * Code 39 badges carry. Operators, however, type only the digits, and hardware
 * scanners type the whole thing — so every entry point normalises through here.
 */

/** The `C-` the UI renders as a fixed affix; never part of an input's value. */
export const COMPETITOR_ID_PREFIX = "C-";

/**
 * Digits as they should sit inside a prefixed input. Accepts anything an
 * operator or a wedge scanner can produce — `42`, `c-42`, `C-0042`, stray
 * whitespace — and returns just the digits, so a scanned `C-0042` typed into a
 * field that already shows `C-` cannot become `C-C-0042`.
 */
export function competitorIdDigits(raw: string): string {
  return raw.trim().replace(/^[cC]\s*-\s*/, "").replace(/\D/g, "");
}

/**
 * Canonical `C-0042` for sending to the API, or null when there is nothing to
 * look up. Zero-pads to four digits so `C-14` resolves like `C-0014`.
 */
export function normaliseCompetitorId(raw: string): string | null {
  const digits = competitorIdDigits(raw);
  if (!digits) return null;
  return `${COMPETITOR_ID_PREFIX}${digits.padStart(4, "0")}`;
}
