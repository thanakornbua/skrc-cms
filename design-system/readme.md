# SKRC Design System

Design system for **Advanced Competitive Robotics Science** — a robotics course run by
the **Suankularb Robotics Club (SKRC)** at โรงเรียนสวนกุหลาบวิทยาลัย (Suankularb
Witthayalai School). The system spans slide decks, printed handouts, credential slips,
email, public result-lookup pages, and any future club material.

**Personality:** clean lab · technical precision · energetic gradient · approachable
engineering · structured learning. A serious club for capable students — not corporate,
not childish.

## Sources

This system was authored from a written brand brief (no codebase or Figma was attached).
If you have updated source material — brand photography, the production codebase for the
result-lookup site, or font license files — re-attach it and this system should be
reconciled against it. The official school emblem (`uploads/Suankularb_Wittayalai_School_emblem.png`)
is the one real brand asset in the system — see Iconography and the Brand guideline card.

## Index — what's in this project

- `index.html` — **self-contained living style guide** (open directly, no build). Every
  token and component rendered live with copy buttons and a paste-ready CSS / Tailwind export.
- `styles.css` — global entry point (the file consumers link). `@import` manifest only.
- `tokens/` — `fonts.css`, `colors.css`, `typography.css`, `spacing.css`,
  `radius-shadow.css`, `base.css` (resets + brand utility classes).
- `components/` — reusable React primitives:
  - `core/` — `Button`, `Badge`, `Card`, `SectionDivider`
  - `forms/` — `Input`
  - `patterns/` — `CredentialSlip`, `ResultCard`
- `ui_kits/` — full-screen recreations: `results-lookup/`, `interview-timer/`, `email/`
- `slides/` — sample 16:9 slides: title, divider, content, scoreboard
- `guidelines/cards/` — foundation specimen cards (Colors / Type / Spacing / Brand)
- `SKILL.md` — Agent-Skill manifest for use in Claude Code.

The Design System tab renders every `@dsCard`-tagged file grouped by concern.

---

## CONTENT FUNDAMENTALS

**Bilingual, Thai-first.** Thai is the primary language; English is a secondary gloss,
usually after a slash. Pattern: `ผ่านการคัดเลือก / Selected`, `ดูผลการคัดเลือก`,
`เลขประจำตัวสอบ / Student ID`. Headings and labels frequently carry both.

**Tone:** clear, encouraging, instructional — addresses the student directly and warmly
(`ยินดีด้วย — คุณผ่านการคัดเลือก` / "Congratulations — you've been selected"). Respectful
Thai register with student salutations (`ด.ช.`, `ด.ญ.`). Not stiff, not cute.

**Casing:** English eyebrows, button labels, and nav are **UPPERCASE mono** with wide
tracking (`ADVANCED COMPETITIVE ROBOTICS SCIENCE`). Body sentence case. Thai has no case,
so weight and the mono/sans split carry hierarchy instead.

**Technical identifiers are sacred** — registration numbers (`SKRC-2026-0418`), usernames
(`skrc.s0418`), passwords (`m0t0r-7x9-Qk`), file names (`intro-to-arduino.pdf`) always
render in IBM Plex Mono, never paraphrased.

**No emoji.** State is communicated with semantic color + words, not emoji or decorative
icons. Numbers are used only when meaningful (a score, a rank, a countdown) — never as
filler.

---

## VISUAL FOUNDATIONS

**The gradient is the brand.** A single `linear-gradient(135deg, #e040fb, #7c3aed 50%,
#3b82f6)` — magenta → violet → blue. Fixed at 135°, always in this order, never rotated or
reversed. It appears as: full-bleed section dividers, gradient-clipped heading/label text,
primary button fills, thin 4–6px accent bars on cards and code blocks, active states.
**It is an accent, not a wash** — large areas stay white-lab, the gradient frames and
energizes.

**Surface & color vibe:** bright, clinical, spacious. Page background is a soft
purple-tinted off-white `#fdfbff`; cards are pure white; secondary surfaces and inputs use
a light purple `#f4f0ff`. The dark tone is `#1a1a2e` (never pure black) — reserved for code
panels and credential fields. Semantic green/amber/red are used strictly for state.

**Type:** IBM Plex family only. Plex Sans (Latin) + Plex Sans Thai (Thai) for everything
human-readable; Plex Mono for everything technical. Headings are bold with tight
tracking (-0.01em); mono labels are uppercase with 0.1em tracking; body line-height is a
generous 1.7.

**Spacing & layout:** strict 8px grid (4 → 64). Generous whitespace, structured columns,
content that reads at a glance whether projected, on a phone, or printed and cut. Credential
slips are a fixed 280px so they print and cut cleanly.

**Corners & cards:** rounded but restrained — sm 6px (inputs/badges), md 10px (cards),
lg 14px (large cards/modals), xl 20px (hero), pill for buttons/tags. A standard card is
white + 1px `#e5e7eb` border + soft shadow + a 4px gradient top accent bar. Accent cards
swap to the purple surface and a purple border. Info cards use a gradient *left* border.

**Shadows:** soft purple-blue depth, never grey/black, never stacked — `rgba(109,40,217,…)`
at four steps (sm → xl). They lift cards gently; depth increases on hover.

**Motion & interaction:** restrained and functional. Buttons brighten (`brightness(1.05)`)
and lift to a larger shadow on hover, and scale to 0.98 on press. Inputs animate border
color + a soft purple focus glow (`0 0 0 3px rgba(124,58,237,.15)`). Transitions ~0.15s
ease. No bounces, no infinite decorative loops, no parallax. Disabled = 0.4 opacity, no
pointer events.

**Transparency/blur:** sparing — the sticky guide nav uses a light backdrop blur; status
badges use 15%-opacity semantic fills. Otherwise surfaces are solid.

**No imagery system yet** — there is no brand photography or illustration library. The
visual interest comes entirely from the gradient, type, and structured white space. If
photography is added later it should read cool/clinical to match the lab personality.

---

## ICONOGRAPHY

The brand currently uses **no icon set and no emoji.** This is deliberate: hierarchy and
state come from typography (the mono/sans split, uppercase eyebrows), semantic color, and
the gradient — not from icons.

Where a glyph is genuinely needed, simple **Unicode marks** are used inline in mono context
(e.g. `→` for resource links, `·` as a separator, `✓`/`✗` only if a checkmark is truly
required). The one real mark in the system is the official **school emblem**
(`uploads/Suankularb_Wittayalai_School_emblem.png`, 1042×1042 PNG, transparent bg) —
use it, not the "SKRC" mono wordmark, wherever an official mark is needed. Min size 24px,
clear space 0.25× diameter, never recolour/rotate/stretch. See the Brand guideline card
for placement on white/dark/gradient and the name lockup.

**If you need a proper icon set:** there is no built-in font or SVG sprite to copy. Use
**Lucide** (https://lucide.dev) from CDN — its 2px even stroke matches the clean-lab feel —
and keep icons monochrome (inherit `currentColor`, typically `--color-muted` or a gradient
clip for emphasis). **This is a substitution flagged for review** — confirm an icon
direction before standardizing one. Do not hand-draw bespoke SVG icons or introduce emoji.

---

## Using the system

Consumers link one file:

```html
<link rel="stylesheet" href="styles.css">
```

Then read tokens as CSS custom properties (`var(--gradient-brand)`, `var(--color-bg)`, …)
and mount components from the compiled bundle:

```html
<script src="_ds_bundle.js"></script>
<script>
  const { Button, ResultCard, CredentialSlip } = window.SKRCDesignSystem_2809c6;
</script>
```

The fastest paste-ready reference for a new project is the **Export** section at the bottom
of `index.html` (CSS `:root` block + `tailwind.config.js`).

## Notes & caveats

- **Fonts load from Google Fonts CDN** (`tokens/fonts.css`). The requested IBM Plex
  families are available there verbatim, so no substitution was needed — but the system is
  **not fully offline** until those `@import`s are swapped for local base64 `@font-face`
  rules. `index.html` degrades to system fonts when offline.
- No brand photography or illustration assets were provided; placeholders are used there.
  The school emblem, however, is a real production asset.
