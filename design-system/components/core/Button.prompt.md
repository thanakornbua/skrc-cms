Primary action button — pill shape, gradient fill, IBM Plex Mono uppercase. Use for the main CTA on any surface (submit, download consent, register).

```jsx
<Button onClick={submit}>ดูผลการคัดเลือก</Button>
<Button variant="secondary">Back</Button>
<Button variant="ghost" size="sm">Cancel</Button>
<Button disabled>Submit</Button>
```

Variants: `primary` (gradient fill, white text), `secondary` (white fill, gradient border + gradient text), `ghost` (gradient text, underline on hover). Sizes: `sm`, `md`. States are built in — hover brightens + lifts the shadow, active scales to 0.98, disabled drops to 0.4 opacity with no pointer events. One primary button per view.
