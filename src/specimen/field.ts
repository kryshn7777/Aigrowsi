// The specimen on the CPU: the same signed distance field the GPU bakes, used for readouts
// (section profiles, stake positions) so every number on the page is measured from the drawing itself.
import data from './specimen.json'

export const LAYER_H = 0.085
export const SUMMIT_H = 0.06
export const RADII: number[] = data.radii // base (0) … summit (12)
export const STAKED_R: number = data.stakedRadius
export const DOMAIN = data.domain
export const WARP: number = data.warp
export const GROWTH: number = data.growth
export const FUSE = data.fuse as { pair: [string, string]; x: number; z: number; r: number }[]
export const TOP = RADII.length - 1

// Base → summit. Names and notes come from the AIGROW brief's own vocabulary.
export const LAYERS = [
  { name: 'Purpose', note: 'Measurable objectives. What success looks like.' },
  { name: 'Boundaries', note: 'Permissions, budgets, operational limits.' },
  { name: 'Oversight', note: 'Human ownership and escalation paths.' },
  { name: 'Baselines', note: 'The explicit reference every change is measured against.' },
  { name: 'Evaluation', note: 'Real tasks, agreed criteria, adversarial cases.' },
  { name: 'Traces', note: 'Outputs, costs, edge cases and failure signals.' },
  { name: 'Feedback', note: 'Evidence that decides the next step.' },
  { name: 'Handoffs', note: 'Explicit roles between models, agents and people.' },
  { name: 'Knowledge', note: 'Private knowledge and data.' },
  { name: 'Tools', note: 'Which tools to use.' },
  { name: 'Agents', note: 'Specialized agents.' },
  { name: 'Context', note: 'Where to look.' },
  { name: 'Model', note: 'A model can generate an answer.' },
] as const

const segs = (() => {
  const out: number[] = []
  for (const flat of data.rings as number[][]) {
    const n = flat.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      out.push(flat[i * 2], flat[i * 2 + 1], flat[j * 2], flat[j * 2 + 1])
    }
  }
  return Float32Array.from(out)
})()
export const SEGMENTS = segs

// Keep in sync with scripts/build-specimen.mjs and the bake shader.
const terrain = (x: number, z: number) =>
  0.5 * Math.sin(0.83 * x + 1.7) * Math.cos(0.61 * z - 0.9) +
  0.3 * Math.sin(0.47 * x - 1.13 * z + 2.1) +
  0.2 * Math.cos(1.37 * x + 0.71 * z + 0.4)

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function fieldAt(x: number, z: number): number {
  let best = Infinity
  let wind = 0
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i]
    const az = segs[i + 1]
    const ex = segs[i + 2] - ax
    const ez = segs[i + 3] - az
    const px = x - ax
    const pz = z - az
    const t = Math.min(1, Math.max(0, (px * ex + pz * ez) / (ex * ex + ez * ez)))
    const dx = px - ex * t
    const dz = pz - ez * t
    const d = dx * dx + dz * dz
    if (d < best) best = d
    if (az <= z !== segs[i + 3] <= z) {
      const xi = ax + ((z - az) / ez) * ex
      if (x < xi) wind += ez > 0 ? 1 : -1
    }
  }
  const d = wind !== 0 ? -Math.sqrt(best) : Math.sqrt(best)
  return d + WARP * terrain(x, z) * smoothstep(0.1, 2.6, d) * d
}

/** Highest layer standing at a point (−1 = bare plate). */
export function layerAt(f: number): number {
  for (let i = TOP; i >= 0; i--) if (f < RADII[i]) return i
  return -1
}

export const layerTop = (i: number) => (i < 0 ? 0 : (i + 1) * LAYER_H + (i === TOP ? SUMMIT_H : 0))

export type Profile = {
  heights: number[]
  /** layers in the order the section line passes over them */
  crossed: number[]
  length: number
}

export function sectionProfile(ax: number, az: number, bx: number, bz: number, n = 220): Profile {
  const heights: number[] = []
  const crossed: number[] = []
  let last = -2
  for (let k = 0; k <= n; k++) {
    const t = k / n
    const layer = layerAt(fieldAt(ax + (bx - ax) * t, az + (bz - az) * t))
    heights.push(layerTop(layer))
    if (layer !== last && layer >= 0 && crossed[crossed.length - 1] !== layer) crossed.push(layer)
    last = layer
  }
  return { heights, crossed, length: Math.hypot(bx - ax, bz - az) }
}

/** Where a ray from the specimen's centre meets a given contour. */
export function reach(angle: number, radius: number) {
  const dx = Math.cos(angle)
  const dz = Math.sin(angle)
  let lo = 0
  let hi = 9
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (fieldAt(dx * mid, dz * mid) < radius) lo = mid
    else hi = mid
  }
  return [dx * lo, dz * lo] as const
}

// Four stakes on the staked contour, one per question of the Define phase (north, east, south, west).
export const STAKES = [-Math.PI / 2, 0, Math.PI / 2, Math.PI].map((a) => reach(a, STAKED_R))

// Anchor for layer labels: where each layer's edge meets the +x axis. The inner rings still follow
// separate letters, so for those the search is replaced by the edge of the W.
/** Plate z of each fuse callout: alternately below and above the word, so neighbours never collide. */
export const FUSE_TAIL = FUSE.map((_, k) => (k % 2 ? data.wordBounds.minZ - 0.62 : data.wordBounds.maxZ + 0.62))
export const LAYER_EDGE_X = RADII.map((r) => (r < 0.3 ? data.wordBounds.maxX + r : reach(0, r)[0]))
