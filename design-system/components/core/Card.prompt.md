Card surface in four variants. The standard card carries a 4px gradient top accent bar; use it for most content blocks.

```jsx
<Card><h3>Standard</h3><p>White surface, gradient top bar.</p></Card>
<Card variant="accent">Light purple panel — supporting info.</Card>
<Card variant="info">Left gradient border — callouts and notices.</Card>
<Card variant="code"><pre>chmod +x flash.sh</pre></Card>
```

Variants: `standard` (white + shadow-md + gradient top bar, toggle with `accentBar={false}`), `accent` (surface-2 + purple border), `info` (4px gradient left border), `code` (dark #1a1a2e, mono — for code blocks and credential displays). Never stack shadows.
