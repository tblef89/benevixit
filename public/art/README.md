# art/ — transition scenes

Drop SVGs here; wire them to pages in `scenes.json`. That's the whole
workflow — no code changes to swap art, ever.

## scenes.json

```json
{
  "defaults": { "particles": 1400, "scale": 0.5, "formMs": 750, "holdMs": 300 },
  "scenes": [
    { "match": "^/product/", "art": "/art/wordmark.svg", "scale": 0.6 }
  ]
}
```

- `match` — JavaScript regex tested against the **arriving** page's pathname.
  First match wins, top to bottom.
- `art` — the SVG whose outlines the particles draw while the page loads
  behind the cover.
- Per-scene overrides: `particles` (point count), `scale` (fraction of the
  shorter viewport side the art occupies), `formMs` (particle convergence
  time), `holdMs` (how long the formed art holds before dissolving into the
  page).
- A scene whose SVG is missing or malformed falls back to the plain dither —
  broken art can't break navigation.

## SVG requirements

- A proper `viewBox` (dimensions don't matter; everything is normalized).
- Real vector geometry: `path`, `circle`, `rect`, `ellipse`, `line`,
  `polyline`, `polygon`. Points are sampled along outlines, so **strokes and
  outlines read better than large filled shapes**.
- Flatten transforms on export (no `transform="matrix(...)"` on geometry).
- Convert text to outlines.
- Single color is ideal — particles are always drawn in ink.
