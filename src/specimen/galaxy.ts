// The galaxy ("COMPOUND"): constants, seeded catalogues and the cosmos camera rig. Units are kpc.
// Pure data and maths (plus the camera rig); no GPU resources are created here.
import { PerspectiveCamera, Vector3 } from 'three'

/** Grand-design SAc spiral, spec B. The arm law is the specimen's law: each ring 24% wider, 1/13 of a turn apart. */
export const GAL = {
  /** arms */
  m: 2,
  tanPhi: 0.4451,
  R0: 0.886,
  /** ring growth per knot (A(k) = R0 * GROWTH^k at theta = k * KNOT_DEG) */
  growth: 1.24,
  knotDeg: 27.69,
  warpAmp: 0.6,
  spurAmp: 0.25,
  /** disk */
  diskScale: 3.2,
  diskThin: 0.22,
  diskYoung: 0.09,
  diskThick: 0.7,
  thickScale: 3.6,
  thickAmp: 0.12,
  truncA: 14.5,
  truncB: 17.5,
  /** bulge (Sersic) */
  bulgeN: 2.5,
  bulgeB: 4.67,
  bulgeRe: 0.85,
  bulgeQ: 0.72,
  bulgeK: 4300,
  nucleus: 0.03,
  ringR: 0.6,
  ringW: 0.06,
  /** dust */
  dustKappa: 2.4,
  dustH: 0.07,
  dustLane: 0.55,
  dustK: [0.72, 1, 1.3] as const,
  /** HII */
  hiiPsi: -0.2,
  /** map extent: +-MAP_HALF kpc */
  mapHalf: 20,
  /** star luminosity tail: L = Lmin * u^(-1/ALPHA), capped at CAP * Lmin */
  lumAlpha: 1.3,
  lumCap: 3000,
}

/** The arm phase's GLSL twin lives in galaxyShaders.ts (mapBake): keep both on this definition. */

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DEG = Math.PI / 180

/** Arm knot A(k): [x, z]. B(k) = -A(k). k = 0..12 are the 13 layers; A(13) is layer 14 (the staked one). */
export function armPoint(k: number): [number, number] {
  const R = GAL.R0 * Math.pow(GAL.growth, k)
  const th = k * GAL.knotDeg * DEG
  return [R * Math.cos(th), R * Math.sin(th)]
}

// ------------------------------------------------------------------ arm phase warp (CPU + GPU agree)
const lattice = (ix: number, iy: number) => {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}
const quint = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
function valueNoise(x: number, y: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const u = quint(x - ix)
  const v = quint(y - iy)
  const a = lattice(ix, iy)
  const b = lattice(ix + 1, iy)
  const c = lattice(ix, iy + 1)
  const d = lattice(ix + 1, iy + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}
/** Centred (about 0) two-octave noise in [-1, 1]: the "fbm(xz * .5)" of the arm phase. Centred so A(k) sits on the arm ridge. */
export function warpAt(x: number, z: number) {
  return 2 * (0.65 * valueNoise(x * 0.5, z * 0.5) + 0.35 * valueNoise(x + 31.7, z - 12.3)) - 1
}
/** warpAt baked onto an n x n grid over the map extent (R8: 0.5 = 0), uploaded as a texture so the GPU map agrees with the CPU catalogue. */
export function warpGrid(n = 256) {
  const data = new Uint8Array(n * n)
  const span = GAL.mapHalf * 2
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const w = warpAt(((i + 0.5) / n - 0.5) * span, ((j + 0.5) / n - 0.5) * span)
      data[i + j * n] = Math.round(Math.min(1, Math.max(0, 0.5 + 0.5 * w)) * 255)
    }
  return data
}

// ------------------------------------------------------------------ blackbody LUT (spec A palette)
const BB: [number, number, number, number][] = [
  [3000, 0xff, 0xb4, 0x6b],
  [4000, 0xff, 0xd1, 0xa3],
  [5000, 0xff, 0xe4, 0xce],
  [5800, 0xff, 0xf1, 0xe7],
  [7000, 0xf5, 0xf3, 0xff],
  [10000, 0xcc, 0xdb, 0xff],
  [15000, 0xb5, 0xcd, 0xff],
  [30000, 0x9f, 0xbf, 0xff],
]
/** Temperature (K) to sRGB bytes, interpolated in log T between the palette stops. */
export function blackbody(T: number, out: Uint8Array, o: number) {
  const t = Math.log(Math.min(30000, Math.max(3000, T)))
  let i = 0
  while (i < BB.length - 2 && t > Math.log(BB[i + 1][0])) i++
  const a = BB[i]
  const b = BB[i + 1]
  const f = (t - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]))
  for (let c = 0; c < 3; c++) out[o + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f)
}

// ------------------------------------------------------------------ catalogues
export type Catalogue = {
  n: number
  /** kpc, xyz */
  pos: Float32Array
  /** luminosity in Lmin units */
  lum: Float32Array
  /** sRGB bytes, rgb + unused alpha */
  col: Uint8Array
  deep: {
    n: number
    /** kpc from the galaxy, xyz (1.5 to 8 Mpc) */
    pos: Float32Array
    /** flux, size in px at the reference lens, axis ratio, angle (rad) */
    d: Float32Array
    /** sRGB bytes; alpha = morphology * 85 (0 E, 1 S, 2 Irr) */
    col: Uint8Array
  }
}

const smooth01 = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * Stars: disk 70%, arms 15%, bulge 12%, halo 3% (spec B). Deep field: n_deep small galaxies at 1.5-8 Mpc, 60% E / 30% S / 10% Irr.
 * Deterministic in `seed`.
 */
export function catalogues(seed: number, n: number, nDeep = 0): Catalogue {
  const rnd = mulberry32(seed)
  const expo = () => -Math.log(1 - rnd()) // (0, inf)
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd())
  const gamma2 = (h: number) => h * (expo() + expo())
  const laplace = (h: number) => h * expo() * (rnd() < 0.5 ? -1 : 1)
  const sphere = (r: number, out: number[]) => {
    const z = 2 * rnd() - 1
    const s = Math.sqrt(1 - z * z)
    const p = 2 * Math.PI * rnd()
    out[0] = r * s * Math.cos(p)
    out[1] = r * z
    out[2] = r * s * Math.sin(p)
  }

  const pos = new Float32Array(n * 3)
  const lum = new Float32Array(n)
  const col = new Uint8Array(n * 4)
  const nDisk = Math.round(n * 0.7)
  const nArm = Math.round(n * 0.15)
  const nBulge = Math.round(n * 0.12)
  const v = [0, 0, 0]
  const LMIN = { disk: 1, arm: 2.5, bulge: 0.8, halo: 0.6 }

  for (let i = 0; i < n; i++) {
    let x: number, y: number, z: number, T: number, lmin: number
    if (i < nDisk) {
      let R: number
      do R = gamma2(GAL.diskScale)
      while (R > GAL.truncB - 0.1 || rnd() > 1 - smooth01(GAL.truncA, GAL.truncB, R))
      const th = rnd() * 2 * Math.PI
      x = R * Math.cos(th)
      z = R * Math.sin(th)
      y = laplace(rnd() < 0.88 ? GAL.diskThin : GAL.diskThick)
      T = 3500 + 2500 * rnd()
      lmin = LMIN.disk
    } else if (i < nDisk + nArm) {
      let R: number
      do R = 1.5 + gamma2(3.8)
      while (R > 16)
      const psiT = 0.45 * gauss() + GAL.hiiPsi / 2 // young stars sit just downstream of the ridge
      const arm = rnd() < 0.5 ? 0 : 1
      const lr = Math.log(R / GAL.R0) / GAL.tanPhi
      let th = lr + psiT / 2 + arm * Math.PI
      for (let it = 0; it < 3; it++) th = lr + (psiT - GAL.warpAmp * warpAt(R * Math.cos(th), R * Math.sin(th))) / 2 + arm * Math.PI
      x = R * Math.cos(th)
      z = R * Math.sin(th)
      y = laplace(GAL.diskYoung)
      T = 7000 * Math.pow(30000 / 7000, Math.pow(rnd(), 1.8))
      lmin = LMIN.arm
    } else if (i < nDisk + nArm + nBulge) {
      // projected Sersic radius from the enclosed-mass gamma(2n) law, used as the 3D radius
      let r: number
      do {
        const g = expo() + expo() + expo() + expo() + expo()
        r = GAL.bulgeRe * Math.pow(g / GAL.bulgeB, GAL.bulgeN)
      } while (r > 6)
      sphere(r, v)
      x = v[0]
      y = v[1] * GAL.bulgeQ
      z = v[2]
      T = 3200 + 2000 * rnd()
      lmin = LMIN.bulge
    } else {
      sphere(2 * Math.pow(15, rnd()), v) // r^-3 density: log-uniform shells, 2..30 kpc
      x = v[0]
      y = v[1]
      z = v[2]
      T = 4000 + 2000 * rnd()
      lmin = LMIN.halo
    }
    pos[i * 3] = x
    pos[i * 3 + 1] = y
    pos[i * 3 + 2] = z
    lum[i] = lmin * Math.min(GAL.lumCap, Math.pow(Math.max(rnd(), 1e-9), -1 / GAL.lumAlpha))
    blackbody(T, col, i * 4)
    col[i * 4 + 3] = 255
  }

  const dpos = new Float32Array(nDeep * 3)
  const dd = new Float32Array(nDeep * 4)
  const dcol = new Uint8Array(nDeep * 4)
  const lo = 1500 ** 3
  const hi = 8000 ** 3
  for (let i = 0; i < nDeep; i++) {
    sphere(Math.cbrt(lo + rnd() * (hi - lo)), v)
    dpos.set(v, i * 3)
    const u = rnd()
    const type = u < 0.6 ? 0 : u < 0.9 ? 1 : 2
    const flux = Math.min(0.5, Math.exp(Math.log(0.02) + 0.9 * gauss()) * (type === 0 ? 1 : type === 1 ? 0.8 : 0.6))
    const size = type === 0 ? 2 + 4 * rnd() : type === 1 ? 3 + 6 * rnd() : 2 + 3 * rnd()
    const q = type === 0 ? 0.45 + 0.55 * rnd() : type === 1 ? 0.25 + 0.65 * rnd() : 0.6 + 0.4 * rnd()
    dd[i * 4] = flux
    dd[i * 4 + 1] = size
    dd[i * 4 + 2] = q
    dd[i * 4 + 3] = rnd() * Math.PI
    blackbody((type === 0 ? 4500 : type === 1 ? 5800 : 12000) * (0.85 + 0.3 * rnd()), dcol, i * 4)
    dcol[i * 4 + 3] = type * 85
  }
  return { n, pos, lum, col, deep: { n: nDeep, pos: dpos, d: dd, col: dcol } }
}

// ------------------------------------------------------------------ keys
/** Every cosmos key (never filter with startsWith('c'): `coarse` and `cut` exist). */
export const COSMOS_KEYS = ['cTx', 'cTy', 'cTz', 'cYaw', 'cPitch', 'cRoll', 'cRollN', 'cLogD', 'cFov', 'cLock', 'cExpo', 'grown'] as const
export type CosmosKey = (typeof COSMOS_KEYS)[number]
/** Cosmos keys plus the plate's screen-layout keys that the cosmos rig reuses so the target lands on the specimen. SceneState satisfies this once S4 adds the keys. */
export type CosmosRigKeys = Record<CosmosKey, number> & { shiftX?: number; shiftY?: number; left?: number; liftN?: number }

/** M1 (arrival) keys: the whole galaxy at i = 52 deg, core at the slab's upper-left edge; shift/liftN equal STATES.arrival so the target lands where the plan stands. */
export const COSMOS_DEFAULT: CosmosRigKeys = {
  cTx: -6.5,
  cTy: 0,
  cTz: -1.5,
  cYaw: 200,
  cPitch: 38,
  cRoll: -12,
  cRollN: -48,
  cLogD: Math.log10(27),
  cFov: 48,
  cLock: 0,
  cExpo: 2.4,
  grown: 0,
  shiftX: 0.18,
  shiftY: 0.34,
  left: 0,
  liftN: 0.14,
}

/** Feature switches. march (S5 volume pass) is on; the disc planes remain the fallback when it is off, not compiled, or the tier says so. */
export const FLAGS = { march: true, sprites: false, light: false, lock: false, streaks: false, motes: false }

/** `?name=0` in the URL switches a layer off (attribution runs: ?cosmos=0, ?plate=0). Harmless in production. */
export const flagOff = (name: string) => typeof location !== 'undefined' && new URLSearchParams(location.search).get(name) === '0'

/** Volume settings per tier: render-target megapixels, march steps, near-dust octaves (1 or 2); disc = use the planes. */
export function volumeSettings(tier: number, phone: boolean) {
  if (tier >= 5) return { disc: true, mpx: 0.1, steps: 16, oct: 1 }
  if (phone) return { disc: false, mpx: 0.1, steps: 16, oct: tier >= 4 ? 1 : 2 }
  if (tier <= 0) return { disc: false, mpx: 0.38, steps: 32, oct: 2 }
  if (tier <= 3) return { disc: false, mpx: 0.25, steps: 24, oct: 2 }
  return { disc: false, mpx: 0.12, steps: 16, oct: 1 }
}

/**
 * Tileable 64^3 RG8 value noise (two independent channels, 8 cells per tile, contrast stretched around .5), x fastest.
 * The volume reads channel R / G at p / 1.2 and p / .4 kpc: feature sizes ~.15 and ~.05 kpc.
 */
export function noise3D(n = 64, cells = 8) {
  const out = new Uint8Array(n * n * n * 2)
  for (let ch = 0; ch < 2; ch++) {
    const rnd = mulberry32(0x3d015e + ch * 7919)
    const lat = new Float32Array(cells * cells * cells)
    for (let i = 0; i < lat.length; i++) lat[i] = rnd()
    const at = (x: number, y: number, z: number) => lat[((x % cells) * cells + (y % cells)) * cells + (z % cells)]
    for (let z = 0; z < n; z++) {
      const fz = (z / n) * cells
      const iz = Math.floor(fz)
      const w = quint(fz - iz)
      for (let y = 0; y < n; y++) {
        const fy = (y / n) * cells
        const iy = Math.floor(fy)
        const v = quint(fy - iy)
        for (let x = 0; x < n; x++) {
          const fx = (x / n) * cells
          const ix = Math.floor(fx)
          const u = quint(fx - ix)
          const x0 = at(ix, iy, iz) + (at(ix + 1, iy, iz) - at(ix, iy, iz)) * u
          const x1 = at(ix, iy + 1, iz) + (at(ix + 1, iy + 1, iz) - at(ix, iy + 1, iz)) * u
          const x2 = at(ix, iy, iz + 1) + (at(ix + 1, iy, iz + 1) - at(ix, iy, iz + 1)) * u
          const x3 = at(ix, iy + 1, iz + 1) + (at(ix + 1, iy + 1, iz + 1) - at(ix, iy + 1, iz + 1)) * u
          const a = x0 + (x1 - x0) * v
          const b = x2 + (x3 - x2) * v
          const s = (a + (b - a) * w - 0.5) * 1.8 + 0.5
          out[((z * n + y) * n + x) * 2 + ch] = Math.round(Math.min(1, Math.max(0, s)) * 255)
        }
      }
    }
  }
  return out
}

/** Per-root invalidators (a bare R3F invalidate() re-renders every root). Cosmos.tsx / Specimen.tsx fill these in onCreated. */
export const roots: { plate?: () => void; cosmos?: () => void } = {}

// ------------------------------------------------------------------ camera rig
const target = new Vector3()
const right = new Vector3()
const forward = new Vector3()
const up = new Vector3()

/**
 * rigCamera's convention (target + dist along yaw/pitch, up = right x forward, lens shift in projection elements 8/9) plus roll.
 * Roll rotates the up vector about the view axis: positive cRoll leans up to the right, so the picture turns counter-clockwise.
 * Narrow screens (width <= 900): tan(fov/2) *= 1.28/aspect (fov capped at 75 deg) and cRollN is added to the roll.
 * cLock is not handled here yet (S8).
 */
export function cosmosRig(cam: PerspectiveCamera, k: CosmosRigKeys, width: number, height: number) {
  const aspect = width / height
  const wide = width > 900
  const left = wide ? (k.left ?? 0) : 0
  const dist = Math.pow(10, k.cLogD)
  const yaw = k.cYaw * DEG
  const pitch = k.cPitch * DEG
  target.set(k.cTx, k.cTy, k.cTz)
  cam.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    target.z + dist * Math.cos(yaw) * Math.cos(pitch),
  )
  right.set(Math.cos(yaw), 0, -Math.sin(yaw))
  forward.subVectors(target, cam.position).normalize()
  up.crossVectors(right, forward).normalize()
  const roll = (k.cRoll + (wide ? 0 : k.cRollN)) * DEG
  if (roll !== 0) up.multiplyScalar(Math.cos(roll)).addScaledVector(right, Math.sin(roll))
  cam.up.copy(up)
  cam.lookAt(target)
  cam.fov = wide ? k.cFov : Math.min(75, (2 * Math.atan((Math.tan((k.cFov * DEG) / 2) * 1.28) / aspect)) / DEG)
  cam.aspect = aspect
  cam.near = 0.005 // 5 pc: nearer stars are clipped
  cam.far = 30000 // the deep field reaches 8 Mpc
  cam.updateProjectionMatrix()
  cam.projectionMatrix.elements[8] = -((wide ? (k.shiftX ?? 0) : 0) + left / width)
  cam.projectionMatrix.elements[9] = -((k.shiftY ?? 0) + (wide ? 0 : (k.liftN ?? 0)))
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
  cam.updateMatrixWorld(true)
  return { dist }
}
