# AIGROW — a growth record

Single-page site for AIGROW, built from `Website description.txt`. The AIGROW wordmark is the summit
of a laser-cut contour model: thirteen layers, each one the wordmark offset outward by a compounding
radius (every ring 24% wider than the one inside it). The page reads that model as a survey drawing,
lifts it into a card model for the growth loop, and ends on a fourteenth layer that is staked out
but not built: a brief the visitor writes themselves.

All copy lives in `src/content.ts` and comes from the source document. Lines marked `plate` only
describe the drawing.

## Run

```sh
npm install
npm run dev        # http://localhost:3000
npm run build      # static export to out/
npm run preview    # serves out/ on http://localhost:4173
npm run typecheck
```

Deploy the `out/` folder to any static host. Pushes to `main` also deploy to GitHub Pages through
`.github/workflows/pages.yml` (one-time setup: repository Settings → Pages → Source: GitHub Actions); the
workflow builds with `NEXT_PUBLIC_BASE_PATH=/<repo name>` because project sites are served from a sub-path.

## Environment

| Variable | Effect |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Canonical origin, e.g. `https://aigrow.example`. Social-card URLs must be absolute; without it (or a host-provided URL from Vercel, Netlify or Cloudflare Pages) they point at `localhost`. |
| `NEXT_PUBLIC_BASE_PATH` | Optional. Sub-path the site is served from, e.g. `/Aigrowsi` on GitHub Pages. Leave unset for a host that serves from the root. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Optional. Adds an "Email brief" link to the brief composer. Without it nothing is sent anywhere: the brief can only be copied or downloaded, and the page says so. |

## How the specimen is drawn

- `scripts/build-specimen.mjs` (`npm run specimen`) turns the Archivo wordmark into outlines, layer
  radii, fuse points, the field-drawer drawings, the static `public/specimen/plan.svg` and
  `scripts/out/layers.json`. It needs Python 3 with `fontTools` (`scripts/instance-font.py` instances
  the variable font). The generated files are committed; run it only to change the geometry.
- In the browser the wordmark's signed distance field is baked once on the GPU, then
  `src/specimen/shaders.ts` draws it two ways from one source: a cheap plan reading (compiled first,
  shown as soon as it is ready) and a raymarched card model (compiled in the background).
- `src/specimen/scene.ts` holds one mutable scene description per sheet; `src/components/Experience.tsx`
  scrubs between them with GSAP ScrollTrigger and Lenis.
- `npm run render:blender` renders the social card with Cycles from `scripts/out/layers.json`
  (Blender 5.2; set `BLENDER_PATH` if it is installed elsewhere).

## Fallbacks

- No WebGL 2, a failed context or a lost context: the static plan drawing, with text knocked out
  over it. The section instrument hides itself.
- `prefers-reduced-motion`: no smooth scrolling, pinning or camera travel; each passage shows one
  still view of the specimen.
- Slow GPUs: the plan always renders at full resolution; the raymarched model lowers its resolution
  (down to 0.6×) and then drops shadows while frames run long.

## Known limits

- Shader compilation on Windows (ANGLE/D3D) takes about 1 s for the plan and a few seconds for the
  model on first visit; browsers cache the result afterwards.
- `@react-three/fiber` 9.8 logs a `THREE.Clock` deprecation warning from inside the library.
