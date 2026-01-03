# Falling Petals (Static Page)

This repo contains a single static page with a subtle “falling sakura petals” background.

## Run it

- Open `index.html` in your browser (double-click in File Explorer), **or**
- Serve it locally (recommended so `defer` scripts always behave the same):

```bash
npx --yes serve .
```

Then open the URL it prints (usually `http://localhost:3000`).

## Notes

- The animation is drawn on a `<canvas>` (see `assets/scripts/petals.js`).
- If your OS/browser has **Reduce motion** enabled, the animation is automatically slowed down.

