// Builds every geometric asset the site draws, starting from the AIGROW wordmark.
//
//   npm run specimen
//
// The specimen is a stack of 13 layers. The summit layer is the wordmark itself; each layer
// below it is the wordmark offset outward by a compounding radius (every ring 24% wider than
// the one inside it). Outputs:
//   src/specimen/specimen.json  wordmark outlines, layer radii, fuse points (runtime SDF bake + readouts)
//   src/specimen/fields.json    field drawer drawings (SVG path data)
//   public/specimen/plan.svg    static plan drawing (shown when WebGL is unavailable)
//   scripts/out/layers.json     extrudable layer polygons (Blender render)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { contours } from 'd3-contour'

const require = createRequire(import.meta.url)
const fontkit = require('fontkit')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = (p) => path.join(root, p)

const WORD = 'AIGROW'
const WORD_WIDTH = 6.0 // plate units
const TRACKING = 0.075 // em of extra spacing, so neighbouring letters fuse ring by ring
const LAYERS = 13
const FIRST_RING = 0.05
const GROWTH = 1.24
const DOMAIN = { minX: -7, minZ: -4.2, sizeX: 14, sizeZ: 8.4 }

// Growth far from the seed bends to its surroundings. The same warp is applied by the GPU bake
// (src/specimen/shaders.ts) and the CPU readouts (src/specimen/field.ts): keep the three in sync.
const terrain = (x, z) =>
  0.5 * Math.sin(0.83 * x + 1.7) * Math.cos(0.61 * z - 0.9) +
  0.3 * Math.sin(0.47 * x - 1.13 * z + 2.1) +
  0.2 * Math.cos(1.37 * x + 0.71 * z + 0.4)
const smoothstep = (a, b, v) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
const WARP = 0.13
const warped = (sdf) => (x, z) => {
  const d = sdf(x, z)
  return d + WARP * terrain(x, z) * smoothstep(0.1, 2.6, d) * d
}

const ringRadius = (k) => (FIRST_RING * (GROWTH ** k - 1)) / (GROWTH - 1)
const round = (v, p = 4) => Math.round(v * 10 ** p) / 10 ** p

// ---------------------------------------------------------------- wordmark outline
const fontVar = out('src/app/fonts/archivo-wdth.woff2')
const fontStatic = out('scripts/out/archivo-monument.ttf')
if (!fs.existsSync(fontStatic)) {
  fs.mkdirSync(path.dirname(fontStatic), { recursive: true })
  execFileSync('python', [out('scripts/instance-font.py'), fontVar, fontStatic], { stdio: 'inherit' })
}
const font = fontkit.openSync(fontStatic)
const run = font.layout(WORD)

function flattenPath(commands, ox) {
  const rings = []
  let ring = null
  let cx = 0
  let cy = 0
  const push = (x, y) => ring.push([x + ox, y])
  for (const { command, args } of commands) {
    if (command === 'moveTo') {
      if (ring?.length > 2) rings.push(ring)
      ring = []
      ;[cx, cy] = args
      push(cx, cy)
    } else if (command === 'lineTo') {
      ;[cx, cy] = args
      push(cx, cy)
    } else if (command === 'quadraticCurveTo') {
      const [qx, qy, x, y] = args
      for (let i = 1; i <= 12; i++) {
        const t = i / 12
        const a = (1 - t) ** 2
        const b = 2 * (1 - t) * t
        const c = t * t
        push(a * cx + b * qx + c * x, a * cy + b * qy + c * y)
      }
      ;[cx, cy] = [x, y]
    } else if (command === 'bezierCurveTo') {
      const [ax, ay, bx, by, x, y] = args
      for (let i = 1; i <= 16; i++) {
        const t = i / 16
        const u = 1 - t
        push(
          u ** 3 * cx + 3 * u * u * t * ax + 3 * u * t * t * bx + t ** 3 * x,
          u ** 3 * cy + 3 * u * u * t * ay + 3 * u * t * t * by + t ** 3 * y,
        )
      }
      ;[cx, cy] = [x, y]
    } else if (command === 'closePath') {
      if (ring?.length > 2) rings.push(ring)
      ring = null
    }
  }
  if (ring?.length > 2) rings.push(ring)
  // drop duplicate closing points and zero-length edges
  return rings.map((r) => {
    const clean = r.filter((p, i) => {
      const q = r[(i + 1) % r.length]
      return Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.01
    })
    return clean
  })
}

let pen = 0
const glyphRings = run.glyphs.map((glyph, i) => {
  const rings = flattenPath(glyph.path.commands, pen + run.positions[i].xOffset)
  pen += run.positions[i].xAdvance + TRACKING * font.unitsPerEm
  return rings
})

let minX = Infinity
let maxX = -Infinity
let minY = Infinity
let maxY = -Infinity
for (const rings of glyphRings)
  for (const r of rings)
    for (const [x, y] of r) {
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
const scale = WORD_WIDTH / (maxX - minX)
const midX = (minX + maxX) / 2
const midY = (minY + maxY) / 2
// font y points up; on the plan, screen-up is -z
const toPlate = ([x, y]) => [round((x - midX) * scale), round(-(y - midY) * scale)]
const letters = glyphRings.map((rings) => rings.map((r) => r.map(toPlate)))

// ---------------------------------------------------------------- signed distance
function segmentsOf(ringList) {
  const segs = []
  for (const r of ringList)
    for (let i = 0; i < r.length; i++) {
      const a = r[i]
      const b = r[(i + 1) % r.length]
      segs.push(a[0], a[1], b[0], b[1])
    }
  return Float64Array.from(segs)
}

// Exact distance to the outline, negative inside (non-zero winding: variable fonts overlap contours).
function sdfFromSegments(segs) {
  const n = segs.length / 4
  return (x, z) => {
    let best = Infinity
    let wind = 0
    for (let i = 0; i < n; i++) {
      const ax = segs[i * 4]
      const az = segs[i * 4 + 1]
      const bx = segs[i * 4 + 2]
      const bz = segs[i * 4 + 3]
      const ex = bx - ax
      const ez = bz - az
      const px = x - ax
      const pz = z - az
      const t = Math.max(0, Math.min(1, (px * ex + pz * ez) / (ex * ex + ez * ez)))
      const dx = px - ex * t
      const dz = pz - ez * t
      const d = dx * dx + dz * dz
      if (d < best) best = d
      if (az <= z !== bz <= z) {
        const xi = ax + ((z - az) / (bz - az)) * ex
        if (x < xi) wind += bz > az ? 1 : -1
      }
    }
    const d = Math.sqrt(best)
    return wind !== 0 ? -d : d
  }
}

function sampleGrid(sdf, domain, nx, nz) {
  const cx = domain.sizeX / nx
  const cz = domain.sizeZ / nz
  const values = new Float64Array(nx * nz)
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++)
      values[i + j * nx] = -sdf(domain.minX + (i + 0.5) * cx, domain.minZ + (j + 0.5) * cz)
  return { values, nx, nz, cx, cz }
}

// d3-contour treats sample (i, j) as the centre of cell [i, i+1] x [j, j+1]
function contourAt(grid, domain, radius) {
  const [mp] = contours().size([grid.nx, grid.nz]).thresholds([-radius])(grid.values)
  return mp.coordinates.map((polygon) =>
    polygon.map((ring) =>
      ring.slice(0, -1).map(([u, v]) => [round(domain.minX + u * grid.cx, 3), round(domain.minZ + v * grid.cz, 3)]),
    ),
  )
}

function simplify(points, eps) {
  if (points.length < 4) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const [ax, az] = points[a]
    const [bx, bz] = points[b]
    const len = Math.hypot(bx - ax, bz - az) || 1e-9
    let worst = -1
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (az - points[i][1]) - (ax - points[i][0]) * (bz - az)) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > eps) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

const ringPath = (ring, s = 100) =>
  'M' + ring.map(([x, z]) => `${round(x * s, 1)} ${round(z * s, 1)}`).join('L') + 'Z'

// ---------------------------------------------------------------- the specimen
const allRings = letters.flat()
const sdf = warped(sdfFromSegments(segmentsOf(allRings)))
console.time('specimen grid')
const grid = sampleGrid(sdf, DOMAIN, 700, 420)
console.timeEnd('specimen grid')

const radii = Array.from({ length: LAYERS }, (_, i) => round(ringRadius(LAYERS - 1 - i), 5)) // base ... summit
const stakedRadius = round(ringRadius(LAYERS), 5)

// Where neighbouring letters fuse: half the gap between them, at the midpoint of the gap.
function closest(ringsA, ringsB) {
  const segsB = segmentsOf(ringsB)
  let best = { d: Infinity }
  for (const r of ringsA)
    for (const [x, z] of r)
      for (let i = 0; i < segsB.length; i += 4) {
        const [ax, az, bx, bz] = [segsB[i], segsB[i + 1], segsB[i + 2], segsB[i + 3]]
        const ex = bx - ax
        const ez = bz - az
        const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)))
        const qx = ax + ex * t
        const qz = az + ez * t
        const d = Math.hypot(x - qx, z - qz)
        if (d < best.d) best = { d, p: [x, z], q: [qx, qz] }
      }
  return best
}
const fuse = []
for (let i = 0; i < letters.length - 1; i++) {
  const ab = closest(letters[i], letters[i + 1])
  const ba = closest(letters[i + 1], letters[i])
  const c = ab.d < ba.d ? ab : ba
  fuse.push({
    pair: [WORD[i], WORD[i + 1]],
    x: round((c.p[0] + c.q[0]) / 2, 3),
    z: round((c.p[1] + c.q[1]) / 2, 3),
    r: round(c.d / 2, 4),
  })
}

const letterCentres = letters.map((rings, i) => {
  const pts = rings.flat()
  const xs = pts.map((p) => p[0])
  const zs = pts.map((p) => p[1])
  return {
    char: WORD[i],
    x: round((Math.min(...xs) + Math.max(...xs)) / 2, 3),
    z: round((Math.min(...zs) + Math.max(...zs)) / 2, 3),
  }
})

const wordBounds = (() => {
  const pts = allRings.flat()
  return {
    minX: Math.min(...pts.map((p) => p[0])),
    maxX: Math.max(...pts.map((p) => p[0])),
    minZ: Math.min(...pts.map((p) => p[1])),
    maxZ: Math.max(...pts.map((p) => p[1])),
  }
})()

fs.mkdirSync(out('src/specimen'), { recursive: true })
fs.writeFileSync(
  out('src/specimen/specimen.json'),
  JSON.stringify({
    word: WORD,
    domain: DOMAIN,
    wordBounds,
    radii,
    stakedRadius,
    growth: GROWTH,
    warp: WARP,
    fuse,
    letters: letterCentres,
    rings: allRings.map((r) => r.flat()),
  }),
)

const layerPolygons = radii.map((r) => contourAt(grid, DOMAIN, r))
const stakedPolygons = contourAt(grid, DOMAIN, stakedRadius)
fs.writeFileSync(
  out('scripts/out/layers.json'),
  JSON.stringify({
    note: 'Plate units. x right, z toward the viewer of the plan (screen-down). Layer 0 is the base.',
    domain: DOMAIN,
    radii,
    stakedRadius,
    layers: layerPolygons.map((polygons, i) => ({ index: i, radius: radii[i], polygons })),
    staked: { radius: stakedRadius, polygons: stakedPolygons },
    letters,
  }),
)

// Static plan drawing: same contours the WebGL plate draws, for browsers without WebGL.
{
  const s = 100
  const vb = `${DOMAIN.minX * s} ${DOMAIN.minZ * s} ${DOMAIN.sizeX * s} ${DOMAIN.sizeZ * s}`
  const ringsSvg = layerPolygons
    .map((polys, i) => {
      const d = polys.flat().map((ring) => ringPath(simplify(ring, 0.004), s)).join('')
      const index = i % 4 === 0
      return `<path d="${d}" fill="none" stroke="#1d1d1b" stroke-width="${index ? 1.6 : 0.8}" vector-effect="non-scaling-stroke"/>`
    })
    .join('')
  const staked = stakedPolygons
    .flat()
    .map((ring) => ringPath(simplify(ring, 0.004), s))
    .join('')
  const word = allRings.map((r) => ringPath(r, s)).join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Plan of the AIGROW specimen: the wordmark surrounded by thirteen contour rings">` +
    `${ringsSvg}<path d="${staked}" fill="none" stroke="#2433d6" stroke-width="1.2" stroke-dasharray="6 5" vector-effect="non-scaling-stroke"/>` +
    `<path d="${word}" fill="#1d1d1b" fill-rule="nonzero"/></svg>`
  fs.writeFileSync(out('public/specimen/plan.svg'), svg)
}

// ---------------------------------------------------------------- field drawers
const segDist = (x, z, ax, az, bx, bz) => {
  const ex = bx - ax
  const ez = bz - az
  const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)))
  return Math.hypot(x - ax - ex * t, z - az - ez * t)
}
const circle = (cx, cz, r) => (x, z) => Math.hypot(x - cx, z - cz) - r
const capsule = (ax, az, bx, bz, r) => (x, z) => segDist(x, z, ax, az, bx, bz) - r
const box = (cx, cz, h) => (x, z) => {
  const dx = Math.abs(x - cx) - h
  const dz = Math.abs(z - cz) - h
  return Math.hypot(Math.max(dx, 0), Math.max(dz, 0)) + Math.min(Math.max(dx, dz), 0)
}
const union = (...fs) => (x, z) => fs.reduce((m, f) => Math.min(m, f(x, z)), Infinity)

// The drawing shows FIELD_DOMAIN; contours are traced over a wider grid so none is closed along its edge.
const FIELD_DOMAIN = { minX: -2.3, minZ: -1.6, sizeX: 4.6, sizeZ: 3.2 }
const FIELD_GRID = { minX: -2.8, minZ: -2.1, sizeX: 5.6, sizeZ: 4.2 }
const fieldRadii = Array.from({ length: 8 }, (_, k) => round((0.025 * (1.3 ** (k + 1) - 1)) / 0.3, 4))
const fieldSeeds = {
  research: union(
    circle(-1.15, -0.55, 0.07),
    circle(-0.55, -0.85, 0.05),
    circle(0.15, -0.62, 0.09),
    circle(0.85, -0.75, 0.06),
    circle(-0.9, 0.38, 0.08),
    circle(0.05, 0.28, 0.06),
    circle(0.95, 0.45, 0.08),
    circle(0.45, -0.08, 0.05),
  ),
  operations: union(
    capsule(-1.55, 0.4, 1.55, 0.4, 0.035),
    circle(-0.45, 0.4, 0.09),
    circle(0.75, 0.4, 0.07),
    capsule(0.75, 0.4, 0.75, -0.72, 0.03),
    circle(0.75, -0.82, 0.08),
  ),
  decisions: union(
    box(-1.25, 0, 0.1),
    capsule(-1.25, 0, 1.15, -0.85, 0.03),
    capsule(-1.25, 0, 1.35, 0, 0.03),
    capsule(-1.25, 0, 1.15, 0.85, 0.03),
    circle(1.15, -0.85, 0.06),
    circle(1.35, 0, 0.06),
    circle(1.15, 0.85, 0.06),
  ),
}
const fields = {}
for (const [id, seed] of Object.entries(fieldSeeds)) {
  const g = sampleGrid(seed, FIELD_GRID, 560, 420)
  const pathAt = (r) =>
    contourAt(g, FIELD_GRID, r)
      .flat()
      .map((ring) => ringPath(simplify(ring, 0.003)))
      .join('')
  fields[id] = { seed: pathAt(0), rings: fieldRadii.map((r) => ({ r, d: pathAt(r) })) }
}
fs.writeFileSync(
  out('src/specimen/fields.json'),
  JSON.stringify({
    viewBox: `${FIELD_DOMAIN.minX * 100} ${FIELD_DOMAIN.minZ * 100} ${FIELD_DOMAIN.sizeX * 100} ${FIELD_DOMAIN.sizeZ * 100}`,
    fields,
  }),
)

console.log('radii (base → summit):', radii.join(', '))
console.log('staked radius:', stakedRadius)
console.log('fuse:', fuse.map((f) => `${f.pair.join('')} r=${f.r}`).join('  '))
console.log('word bounds:', wordBounds)
console.log('segments:', segmentsOf(allRings).length / 4)
