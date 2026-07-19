# Results Lookup — UI kit

The public page where applicants check their selection outcome for **Advanced
Competitive Robotics Science**.

- `index.html` — interactive entry point. Enter a student ID and submit to see the
  pass/fail result.
- `ResultsLookup.jsx` — the page (header band + lookup form + result), composing the
  `Input`, `Button`, `ResultCard` and `Badge` primitives.

Demo IDs: `SKRC-2026-0418` (passed) · `SKRC-2026-0571` (not selected) · anything else
returns the not-found state.
