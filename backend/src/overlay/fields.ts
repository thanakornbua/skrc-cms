/**
 * The individual values a broadcast overlay can show, each servable as its own
 * page so OBS can carry one Browser Source per element.
 *
 * A single combined overlay forces my layout on the scene. One source per field
 * lets the broadcast team place and style each value where their design wants
 * it — the same freedom the five text files give, without the file-read
 * cadence that made those choppy.
 */
export const OVERLAY_FIELDS = ["stage", "team", "clock", "attempt", "best", "status"] as const;

export type OverlayField = (typeof OVERLAY_FIELDS)[number];

export function isOverlayField(value: string): value is OverlayField {
  return (OVERLAY_FIELDS as readonly string[]).includes(value);
}

/**
 * Presentation knobs, taken from the query string.
 *
 * Every value is validated against a narrow pattern rather than escaped: these
 * land inside a <style> block, where anything unexpected is a way to rewrite
 * the page. A rejected value falls back to the default instead of failing —
 * an overlay that renders plainly beats an overlay that does not render.
 */
export interface FieldStyle {
  size: string;
  color: string;
  weight: string;
  align: string;
  font: string;
}

const SIZE = /^[0-9]{1,4}(\.[0-9]{1,3})?(vh|vw|px|em|rem|%)$/;
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i;
const WEIGHT = /^([1-9]00|normal|bold)$/;
const ALIGN = /^(left|center|right)$/;
/** Font families, not a full font shorthand: letters, digits, spaces, commas. */
const FONT = /^[a-z0-9 ,'-]{1,80}$/i;

/**
 * IBM Plex Sans first, and IBM Plex Sans Thai behind it because Plex Sans
 * carries no Thai glyphs — a Thai team name would otherwise fall through to
 * whatever Windows picked, mid-scene, at a different weight and size. Both
 * must be installed on the machine running OBS; the browser cannot use a font
 * that is not there. See ops/OBS_BRIDGE.md for the install.
 */
export const DEFAULT_FONT_STACK = `"IBM Plex Sans", "IBM Plex Sans Thai", "Segoe UI", system-ui, sans-serif`;

export function fieldStyle(query: Record<string, unknown>): FieldStyle {
  const pick = (key: string, pattern: RegExp, fallback: string): string => {
    const value = query[key];
    return typeof value === "string" && pattern.test(value) ? value : fallback;
  };
  return {
    size: pick("size", SIZE, "9vh"),
    color: pick("color", COLOR, "#ffffff"),
    weight: pick("weight", WEIGHT, "700"),
    align: pick("align", ALIGN, "left"),
    font: pick("font", FONT, DEFAULT_FONT_STACK),
  };
}
