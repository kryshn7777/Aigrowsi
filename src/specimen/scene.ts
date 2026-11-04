// One mutable scene description, written by scroll choreography (GSAP) and user instruments,
// read once per rendered frame. Nothing here touches React state.
import { Color, DataTexture, LinearFilter, Matrix4, PerspectiveCamera, RGBAFormat, RepeatWrapping, Texture, UnsignedByteType, Vector2, Vector3, Vector4 } from 'three'
import { COSMOS_DEFAULT, COSMOS_KEYS, type CosmosKey } from './galaxy'
import { galaxyLight } from './light'
import { DOMAIN, FUSE, FUSE_TAIL, GROWTH, LAYER_EDGE_X, LAYER_H, RADII, STAKED_R, STAKES, SUMMIT_H, TOP } from './field'

type PlateState = {
  tx: number
  ty: number
  tz: number
  yaw: number
  pitch: number
  fov: number
  /** visible height (plate units) at the target */
  frame: number
  /** plate width that must stay in view on narrow screens */
  fit: number
  /** wide screens: CSS px the copy column owns on the left, and plate width that must fit right of it */
  left: number
  span: number
  shiftX: number
  /** narrow screens only: extra upward shift, where the copy stacks beneath the specimen */
  liftN: number
  shiftY: number
  built: number
  explode: number
  coarse: number
  plan: number
  cut: number
  dusk: number
  transect: number
  fuse: number
  bound: number
  front: number
  staked: number
  ghost: number
  labels: number
  visible: number
  /** KERF progress: 0 off, 0.06 foreshadow, 0.10 at the frontier, 1 at the peak */
  rift: number
}
/** the galaxy's camera and growth (spec D/G): target in kpc, angles in degrees, cLogD = log10 of the distance in kpc */
export type CosmosState = Record<CosmosKey, number>
export type SceneState = PlateState & CosmosState

const PLAN: SceneState = {
  tx: 0,
  ty: 0,
  tz: 0,
  yaw: 0,
  pitch: 90,
  fov: 3,
  frame: 10,
  fit: 7.2,
  left: 0,
  span: 0,
  shiftX: 0,
  liftN: 0,
  shiftY: 0,
  built: 13,
  explode: 0,
  coarse: 0,
  plan: 1,
  cut: 0,
  dusk: 0,
  transect: 0,
  fuse: 0,
  bound: 0,
  front: 0,
  staked: 0,
  ghost: 0,
  labels: 0,
  visible: 1,
  rift: 0,
  cTx: 0,
  cTy: 0,
  cTz: 0,
  cYaw: 0,
  cPitch: 90,
  cRoll: 0,
  cRollN: 0,
  cLogD: 1.53,
  cFov: 48,
  cLock: 0,
  cExpo: 1,
  grown: 0,
}
const OBLIQUE: SceneState = { ...PLAN, yaw: -26, pitch: 44, fov: 30, frame: 8.2, fit: 7.6, plan: 0.35 }

/** CSS px of the copy column on wide screens (gutter + 27rem step column + air). */
const COLUMN = 540
/** narrow screens: the framing width (world units) below which the specimen would be cropped by the screen edges */
const NARROW_FIT = 12

/** cosmos keys for one passage: target (kpc), yaw, pitch, distance (kpc), fov, extras (roll, rollN, expo, grown, ...) */
const cam = (t: readonly [number, number, number], yaw: number, pitch: number, d: number, fov = 48, o: Partial<CosmosState> = {}): Partial<CosmosState> => ({
  cTx: t[0],
  cTy: t[1],
  cTz: t[2],
  cYaw: yaw,
  cPitch: pitch,
  cLogD: Math.log10(d),
  cFov: fov,
  ...o,
})
/** M1, the whole galaxy at i = 62: galaxy.ts owns it (the poster and the intro share it) */
const M1 = Object.fromEntries(COSMOS_KEYS.map((k) => [k, COSMOS_DEFAULT[k]])) as CosmosState

const RECORD: SceneState = { ...PLAN, frame: 8.8, left: COLUMN, span: 14.2, shiftY: 0.32, transect: 1, ...cam([2.5, 0, -1.5], 0, 90, 9, 50) }
const RECORD_HOLD = { ...RECORD, cYaw: 15 }

const FRONTIER: SceneState = { ...OBLIQUE, yaw: 24, pitch: 12, fov: 34, frame: 7, fit: 11.5, ty: 0.7, shiftX: 0.1, shiftY: 0.05, dusk: 1, plan: 0, rift: 0.1, ...cam([-4, 0, -4], 60, 3, 10, 34, { grown: 0.1 }) }
const ARRIVAL: SceneState = { ...PLAN, frame: 15.4, fit: 14.6, shiftX: 0.18, shiftY: 0.34, liftN: 0.14, ...M1 }
/** the plate is hidden while the fields are on screen; the camera returns to plan out of sight */
const FIELDS: SceneState = { ...ARRIVAL, visible: 0, shiftX: 0, shiftY: 0.05, ...cam([0, 0, 0], 120, 50, 36, 48, { grown: 1, cExpo: 6 }) }
const RESOLUTION: SceneState = { ...ARRIVAL, grown: 1, cExpo: 3 }

export const STATES = {
  arrival: ARRIVAL,
  record: RECORD,
  // the pinned record turns the galaxy under the transect
  recordHold: RECORD_HOLD,
  // phones only: once the copy has passed, the plan drops into the gap above the readout it is drawn for
  recordLow: { ...RECORD_HOLD, liftN: -0.65 },
  orchestration: { ...PLAN, frame: 9.4, left: COLUMN, span: 12.6, shiftY: -0.04, fuse: 1, ...cam([-2.52, 0, -3.27], 0, 90, 3.5) },
  evaluation: { ...PLAN, frame: 9.4, left: COLUMN, span: 12.6, shiftY: -0.04, transect: 1, ...cam([-1.1, 0, -2.9], 0, 64, 2.8, 44) },
  evolution: { ...PLAN, frame: 10.6, left: COLUMN, span: 13.4, shiftY: -0.04, front: 1, ...cam([3.46, 0, -7.94], 30, 78, 3) },
  governance: { ...PLAN, frame: 10.6, left: COLUMN, span: 12.6, shiftY: -0.04, bound: 1, ...cam([-7, 0, -6], 70, 40, 18, 48, { cExpo: 2.8 }) },
  // liftN (phones only): below the step copy and its tabs, which would otherwise sit on the model
  lift: { ...OBLIQUE, left: COLUMN, span: 11.8, shiftY: -0.06, liftN: -0.62, ...cam([0, 0, 0], 124, 44, 26, 44, { cRollN: -40, cExpo: 1.8 }) },
  define: { ...OBLIQUE, left: COLUMN, span: 11.8, shiftY: -0.06, built: 1, coarse: 1, liftN: -0.62, ...cam([0, 0, 0], -26, 30, 5, 40) },
  compose: { ...OBLIQUE, yaw: -14, pitch: 38, left: COLUMN, span: 11.8, shiftY: -0.06, built: 13, coarse: 1, liftN: -0.62, ...cam([0, 0, 0], -14, 50, 28, 46) },
  instrument: { ...OBLIQUE, yaw: -4, pitch: 20, fov: 28, frame: 6.6, fit: 12, ty: 2.4, left: COLUMN, span: 13.6, shiftX: -0.05, explode: 0.3, labels: 1, coarse: 1, plan: 0.15, ...cam([-2.18, 0.05, -5.74], -4, 20, 1.2, 36) },
  evaluate: { ...OBLIQUE, yaw: 0, pitch: 4, fov: 16, frame: 2.6, tx: 0, ty: 0.55, fit: 12.4, left: COLUMN, span: 12.4, shiftY: 0.1, cut: 1, coarse: 1, plan: 0, ...cam([0, 0, 0], 0, 9, 18, 34, { cRollN: -90, cExpo: 2.2 }) }, // pitch 9: camera stays above the gas slab (|y| <= 2.2 kpc); inside it, wide phone rays crossed the whole midplane and went black
  refine: { ...OBLIQUE, yaw: 14, pitch: 52, fov: 30, frame: 5.4, fit: 6.4, left: COLUMN, span: 11.8, shiftY: -0.06, coarse: 0, ghost: 1, plan: 0.6, ...cam([2.6, 0.15, 1.2], 14, 52, 3, 40, { cExpo: 0.7 }) },
  // locked views (hand-set until S8): cLock stays 0
  principles: { ...OBLIQUE, yaw: -8, pitch: 14, fov: 12, frame: 4.5, fit: 12.6, ty: 0.55, shiftY: -0.18, plan: 0, rift: 0.06, ...cam([-3, 0, -3], 100, 3, 9, 14, { grown: 0.06 }) },
  frontier: FRONTIER,
  // the pinned KERF peak: the board and sky burn away; same dusk framing, drifting wider
  kerf: { ...FRONTIER, yaw: 34, pitch: 9, fov: 40, frame: 9, shiftX: -0.2, liftN: 0.2, rift: 1, ...cam([-4, 0, -4], 45, 1.5, 10, 40, { grown: 1 }) },
  fields: FIELDS,
  // the bottom of the fields: a smudge among the deep field
  deep: { ...FIELDS, ...cam([0, 0, 0], 120, 50, 420, 70, { grown: 1, cExpo: 5 }) },
  // the arrival's own framing: the record closes where it opened
  resolution: RESOLUTION,
  resolutionHold: { ...RESOLUTION, cLogD: Math.log10(25), cExpo: 3.2 },
  next: { ...PLAN, frame: 14.2, fit: 14.2, left: COLUMN + 80, span: 13.4, shiftY: 0.02, liftN: 0.45, staked: 1, ...cam([14.52, 0, 0], 40, 75, 9, 46, { grown: 1 }) },
} satisfies Record<string, SceneState>

export type StateName = keyof typeof STATES

export const scene: SceneState = { ...STATES.arrival, built: 0 }

export const TRANSECT_RECORD = { ax: -1.777, az: -0.05, bx: -5.4, bz: 3.3 }
export const TRANSECT_EVALUATION = { ax: -4.6, az: 3.2, bx: 4.6, bz: -3.2 }

/** Instruments the visitor controls directly. */
export const live = {
  transect: { ax: -1.777, az: -0.05, bx: -5.4, bz: 3.3 },
  /** one per Define question, 0 → 1 as its stake is driven in */
  stakes: [0, 0, 0, 0],
}

// ------------------------------------------------------------------ camera rig
const DEG = Math.PI / 180
const target = new Vector3()
const right = new Vector3()
const forward = new Vector3()
const up = new Vector3()

export function rigCamera(cam: PerspectiveCamera, s: SceneState, width: number, height: number) {
  const aspect = width / height
  // on wide screens the copy owns a column on the left; the subject is framed in the room beside it
  const wide = width > 900
  const left = wide ? s.left : 0
  // on phones the whole specimen must fit the width: states framed for a wide screen are never tighter than NARROW_FIT
  const frame = Math.max(s.frame, Math.max(s.fit, wide ? 0 : NARROW_FIT) / aspect, wide ? (s.span * height) / (width - left) : 0)
  const dist = frame / (2 * Math.tan((s.fov * DEG) / 2))
  const yaw = s.yaw * DEG
  const pitch = s.pitch * DEG
  target.set(s.tx, s.ty, s.tz)
  cam.position.set(
    target.x + dist * Math.sin(yaw) * Math.cos(pitch),
    target.y + dist * Math.sin(pitch),
    target.z + dist * Math.cos(yaw) * Math.cos(pitch),
  )
  right.set(Math.cos(yaw), 0, -Math.sin(yaw))
  forward.subVectors(target, cam.position).normalize()
  up.crossVectors(right, forward).normalize()
  cam.up.copy(up)
  cam.lookAt(target)
  cam.fov = s.fov
  cam.aspect = aspect
  cam.near = Math.max(0.01, dist * 0.02)
  cam.far = dist * 20 + 200
  cam.updateProjectionMatrix()
  // lens shift: moves the subject on screen without changing how it is seen
  cam.projectionMatrix.elements[8] = -((wide ? s.shiftX : 0) + left / width)
  cam.projectionMatrix.elements[9] = -(s.shiftY + (wide ? 0 : s.liftN))
  cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
  cam.updateMatrixWorld(true)
  return { frame, dist }
}

// ------------------------------------------------------------------ light & palette
const hex = (h: string) => new Color(h) // linear (three's colour management converts from sRGB)
export const PALETTE = {
  sheet: hex('#edece7'),
  ink: hex('#1d1d1b'),
  char: hex('#4a3628'),
  blue: hex('#1f2bc0'),
  // KERF: the emissive ramp
  kerfCore: hex('#fff4e0'),
  kerf: hex('#ff9a4d'),
  ember: hex('#c2410c'),
  ice: hex('#a9e4ff'), // survey light: current
  mark: hex('#9aa3ff'), // survey light: proposed
}
/** KERF geometry: R0 = base island edge, RMAX = outer reach, AMP = plate noise, AGE = shard life (field units) */
export const RIFT = { R0: RADII[0] + 0.15, RMAX: 30, AMP: 0.35, AGE: 0.5 }
// Key light elevation ~48 degrees (card faces read their exact colour under it)
const SUN_DAY = new Vector3(-0.5, 0.75, -0.45).normalize()
const AMB_VOID = new Vector3(0.1, 0.12, 0.22)
/** unit vector towards the ice rim light: below and behind the model */
const RIM_DIR = new Vector3(-0.45, -0.5, -0.75).normalize()
const RIM_STRENGTH = 1.4
const KEY_VOID = 0.3 // key light multiplier at full void
const SUN_DUSK = new Vector3(-0.92, 0.2, -0.32).normalize()
const SUN_COL_DAY = new Vector3(1.0, 0.985, 0.96).multiplyScalar(1.7)
const SUN_COL_DUSK = new Vector3(1.0, 0.8, 0.62).multiplyScalar(1.15)
const AMB_DAY = new Vector3(0.93, 0.95, 1.0).multiplyScalar(1.25)
const AMB_DUSK = new Vector3(0.47, 0.46, 0.44).multiplyScalar(0.5) // neutral warm: a blue ambient tinted shadowed sheets icy

const smooth = (t: number) => t * t * (3 - 2 * t)
/** linear 0..1 ramp of x between a and b */
const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))

/** 128x128 tiling value-noise source: seeded (mulberry32), so every load and every shader sample agrees. */
function makeNoise() {
  const n = 128
  const data = new Uint8Array(n * n * 4)
  let a = 0x9e3779b9
  for (let i = 0; i < data.length; i++) {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    data[i] = (((t ^ (t >>> 14)) >>> 0) >>> 24) & 255
  }
  const tex = new DataTexture(data, n, n, RGBAFormat, UnsignedByteType)
  tex.wrapS = tex.wrapT = RepeatWrapping
  tex.magFilter = tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.needsUpdate = true
  return tex
}

/** Writes the scene into the plate shader's uniforms. */
export function syncUniforms(u: PlateUniforms, s: SceneState) {
  const d = smooth(Math.min(1, Math.max(0, s.dusk)))
  u.uSunDir.value.lerpVectors(SUN_DAY, SUN_DUSK, d).normalize()
  u.uSunCol.value.lerpVectors(SUN_COL_DAY, SUN_COL_DUSK, d)
  u.uAmbCol.value.lerpVectors(AMB_DAY, AMB_DUSK, d)
  // KERF: everything derives from rift
  const r = s.rift
  const v = ramp(0.45, 0.8, r)
  const tf = smooth(ramp(0.12, 0.6, r))
  u.uKerfRing.value = r < 0.06 ? r / 0.3 : Math.min(1, 0.2 + 20 * (r - 0.06)) // arc traced: 0.2 at the foreshadow, closed at the frontier
  u.uFrontR.value = RIFT.R0 + (RIFT.RMAX - RIFT.R0) * Math.pow(tf, 2.2)
  u.uStrata.value = 13 * v
  u.uSunCol.value.multiplyScalar(1 - (1 - KEY_VOID) * v)
  u.uAmbCol.value.lerp(AMB_VOID, v)
  // S7: the galaxy core rims the stack (replaces the fixed ice rim) and tints the ambient 35% toward the local galaxy colour
  const vw = typeof document === 'undefined' ? u.uResolution.value.x : document.documentElement.clientWidth
  const vh = typeof document === 'undefined' ? u.uResolution.value.y : document.documentElement.clientHeight
  galaxyLight(s, vw, vh, u.uRimDir.value, u.uRimCol.value, u.uAmbCol.value)
  u.uBuilt.value = s.built
  u.uExplode.value = s.explode
  u.uCoarse.value = s.coarse
  u.uPlan.value = s.plan
  u.uCutZ.value = 12 - 11.98 * smooth(Math.min(1, Math.max(0, s.cut)))
  const t = live.transect
  u.uTransect.value.set(t.ax, t.az, t.bx, t.bz)
  u.uTransectOn.value = s.transect
  u.uFuseOn.value = s.fuse
  const b = smooth(Math.min(1, Math.max(0, s.bound)))
  u.uBound.value.set(40 - (40 - 5.25) * b, 40 - (40 - 2.55) * b, 0.9)
  u.uBoundOn.value = s.bound
  u.uFront.value.set(RADII[0] + 0.34 * smooth(Math.min(1, s.front)), Math.min(1, s.front * 2))
  u.uStaked.value = s.staked
  u.uStakeOn.value.set(live.stakes[0], live.stakes[1], live.stakes[2], live.stakes[3])
  u.uGhost.value = s.ghost * Math.min(1, (1 - s.coarse) * 1.5)
}

export function createUniforms() {
  return {
    uResolution: { value: new Vector2(1, 1) },
    uCamWorld: { value: new Matrix4() },
    uProjInv: { value: new Matrix4() },
    /** replaced by reference with camera.projectionMatrix / matrixWorldInverse (for gl_FragDepth) */
    uProj: { value: new Matrix4() },
    uView: { value: new Matrix4() },
    uCamPos: { value: new Vector3() },
    uPxWorld: { value: 0.01 },
    uTargetDist: { value: 10 },
    uZero: { value: 0 },
    uField: { value: null as Texture | null },
    uDomain: { value: new Vector4(DOMAIN.minX, DOMAIN.minZ, DOMAIN.sizeX, DOMAIN.sizeZ) },
    uRadii: { value: RADII.slice() },
    uRing0: { value: RADII[TOP - 1] },
    uGrowth: { value: GROWTH },
    uLayerH: { value: LAYER_H },
    uSummitH: { value: SUMMIT_H },
    uBuilt: { value: 0 },
    uExplode: { value: 0 },
    uCoarse: { value: 0 },
    uDrop: { value: 1.7 },
    uSunDir: { value: SUN_DAY.clone() },
    uSunCol: { value: SUN_COL_DAY.clone() },
    uAmbCol: { value: AMB_DAY.clone() },
    uSheetCol: { value: PALETTE.sheet.clone() },
    uInkCol: { value: PALETTE.ink.clone() },
    uCharCol: { value: PALETTE.char.clone() },
    uBlueCol: { value: PALETTE.blue.clone() },
    uPlan: { value: 1 },
    uCutZ: { value: 12 },
    uTransect: { value: new Vector4() },
    uTransectOn: { value: 0 },
    uFuse: { value: FUSE.map((f) => new Vector3(f.x, f.z, f.r)) },
    uFuseTail: { value: FUSE_TAIL.slice() },
    uFuseOn: { value: 0 },
    uBound: { value: new Vector3(40, 40, 0.9) },
    uBoundOn: { value: 0 },
    uFront: { value: new Vector2() },
    uRollbackR: { value: RADII[0] },
    uStakedR: { value: STAKED_R },
    uStaked: { value: 0 },
    uStakes: { value: STAKES.map(([x, z]) => new Vector2(x, z)) },
    uStakeOn: { value: new Vector4() },
    uGhost: { value: 0 },
    uSteps: { value: 160 },
    uShadows: { value: 1 },
    // KERF (derived from scene.rift in syncUniforms)
    uKerfRing: { value: 0 },
    uFrontR: { value: RIFT.R0 },
    uStrata: { value: 0 },
    /** governor: 1 full KERF detail, 0 = skip isolines/strata/glow */
    uRiftQ: { value: 1 },
    uNoise: { value: makeNoise() as Texture },
    uRimDir: { value: RIM_DIR.clone() },
    uRimCol: { value: new Color(0, 0, 0) },
    uKerfCoreCol: { value: PALETTE.kerfCore.clone() },
    uKerfCol: { value: PALETTE.kerf.clone() },
    uEmberCol: { value: PALETTE.ember.clone() },
    uIceCol: { value: PALETTE.ice.clone() },
    uMarkCol: { value: PALETTE.mark.clone() },
  }
}
export type PlateUniforms = ReturnType<typeof createUniforms>

// ------------------------------------------------------------------ world-anchored labels
export type Label = {
  el: HTMLElement
  at: () => readonly [number, number, number]
  opacity: () => number
}
export const labels = new Set<Label>()

/** Plate position of layer i's label anchor, following the exploded/settled stack. */
export function layerAnchor(i: number): [number, number, number] {
  const a = Math.min(1, Math.max(0, scene.built - i))
  const y0 = i * (LAYER_H + scene.explode) + (1 - (1 - (1 - a) ** 3)) * 1.7
  const t = i === TOP ? LAYER_H + SUMMIT_H : LAYER_H
  return [LAYER_EDGE_X[i], y0 + t / 2, 0]
}

export const stakeAnchor = (k: number): [number, number, number] => [STAKES[k][0], 0, STAKES[k][1]]
export const fuseAnchor = (k: number): [number, number, number] => [FUSE[k].x, LAYER_H * 7, FUSE_TAIL[k]]

const liveHash = () =>
  live.stakes[0] * 7.1 + live.stakes[1] * 8.3 + live.stakes[2] * 9.7 + live.stakes[3] * 10.9 + live.transect.ax * 3.3 + live.transect.az * 5.7 + live.transect.bx * 11.3 + live.transect.bz * 13.1

/** Cheap fingerprints of what changes each canvas' picture. The plate ignores the galaxy camera; the cosmos ignores the specimen camera (until the lock blends them). */
export function plateSignature(s: SceneState) {
  let h = liveHash()
  let k = 1
  for (const [n, v] of Object.entries(s)) {
    k += 1.618
    if (!COSMOS_SET.has(n)) h += v * k
  }
  return h
}

const COSMOS_SET = new Set<string>(COSMOS_KEYS)
const COSMOS_LAYOUT = ['shiftX', 'shiftY', 'left', 'liftN', 'built', 'staked'] as const
export function cosmosSignature(s: SceneState) {
  let h = live.stakes[0] * 7.1 + live.stakes[1] * 8.3 + live.stakes[2] * 9.7 + live.stakes[3] * 10.9
  let k = 1
  if (s.cLock > 0) {
    for (const v of Object.values(s)) h += v * (k += 1.618)
    return h
  }
  for (const n of COSMOS_KEYS) h += s[n] * (k += 1.618)
  for (const n of COSMOS_LAYOUT) h += s[n] * (k += 1.618)
  return h
}

// ------------------------------------------------------------------ governor
/**
 * The one quality ladder (spec C). Both canvases call quality.feed() from their useFrame; samples under 4 ms apart are the same rAF and
 * count once. A 36-frame average above 26 ms steps down, below 18.5 ms steps up (never while a recent step down is cooling off).
 * level: 0 T0 | 1 T1 volume .25 x24 | 2 T2 plate DPR .8 | 3 T2 plate DPR .6 | 4 T3 shadows off, stars 80k |
 *        5 T4 volume .12 x16 one octave, riftQ 0, half the shards | 6 T5 discs replace the volume, stars 40k, cosmos DPR 1.
 * Phones start at P (= level 0: the volume is already .1 x16 and 50k stars) and may fall to T5.
 */
export const PLATE_DPR = [1, 1, 0.8, 0.6, 0.6, 0.6, 0.6]
const TIER = [0, 1, 2, 2, 3, 4, 5]
export const quality = {
  level: 0,
  /** the plate is on the raymarched model (Specimen sets it each frame): the cosmos uses at most T1 volume settings */
  marching: false,
  phone: false,
  subs: new Set<() => void>(),
  get tier() {
    return TIER[this.level]
  },
  label() {
    return this.phone && this.level === 0 ? 'P' : `T${TIER[this.level]}`
  },
  feed(now: number) {
    if (gov.pin) return
    const dt = now - gov.last
    if (dt < 4) return // the other canvas, same rAF
    gov.last = now
    if (dt > 1500) return // idle gap, not a frame time
    gov.sum += Math.min(dt, 100) // a stalled frame counts (capped): an overloaded GPU shows up as 100+ ms frames, not as fast ones
    if (++gov.n < 36) return
    const avg = gov.sum / gov.n
    gov.sum = gov.n = 0
    if (avg > 26 && this.level < 6) {
      // a step down soon after a step up doubles the cool-off: the ladder settles instead of oscillating
      gov.ban = now - gov.up < gov.ban ? Math.min(gov.ban * 2, 120000) : 10000
      gov.block = now + gov.ban
      this.set(this.level + 1)
    } else if (avg < 18.5 && this.level > 0 && now > gov.block) {
      gov.up = now
      this.set(this.level - 1)
    }
  },
  set(level: number) {
    this.level = Math.max(0, Math.min(6, level))
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.tier = this.label()
      document.documentElement.dataset.level = String(this.level)
    }
    this.subs.forEach((f) => f())
  },
}
const gov = { last: 0, sum: 0, n: 0, up: -1e9, block: 0, ban: 10000, pin: false }
// ?tier=N pins the ladder at level N (0..6) for measurements and screenshots
if (typeof location !== 'undefined' && /[?&]tier=\d/.test(location.search)) {
  gov.pin = true
  quality.level = Math.min(6, +(/[?&]tier=(\d)/.exec(location.search) as RegExpExecArray)[1])
}
