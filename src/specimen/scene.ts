// One mutable scene description, written by scroll choreography (GSAP) and user instruments,
// read once per rendered frame. Nothing here touches React state.
import { Color, Matrix4, PerspectiveCamera, Texture, Vector2, Vector3, Vector4 } from 'three'
import { DOMAIN, FUSE, FUSE_TAIL, GROWTH, LAYER_EDGE_X, LAYER_H, RADII, STAKED_R, STAKES, SUMMIT_H, TOP } from './field'

export type SceneState = {
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
}

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
}
const OBLIQUE: SceneState = { ...PLAN, yaw: -26, pitch: 44, fov: 30, frame: 8.2, fit: 7.6, plan: 0.35 }

/** CSS px of the copy column on wide screens (gutter + 27rem step column + air). */
const COLUMN = 540

export const STATES = {
  arrival: { ...PLAN, frame: 12.6, fit: 12, shiftX: 0.18, shiftY: 0.34, liftN: 0.14 },
  record: { ...PLAN, frame: 8.8, left: COLUMN, span: 14.2, shiftY: 0.32, transect: 1 },
  orchestration: { ...PLAN, frame: 9.4, left: COLUMN, span: 12.6, shiftY: -0.04, fuse: 1 },
  evaluation: { ...PLAN, frame: 9.4, left: COLUMN, span: 12.6, shiftY: -0.04, transect: 1 },
  evolution: { ...PLAN, frame: 10.6, left: COLUMN, span: 13.4, shiftY: -0.04, front: 1 },
  governance: { ...PLAN, frame: 10.6, left: COLUMN, span: 12.6, shiftY: -0.04, bound: 1 },
  lift: { ...OBLIQUE, left: COLUMN, span: 11.8, shiftY: -0.06 },
  define: { ...OBLIQUE, left: COLUMN, span: 11.8, shiftY: -0.06, built: 1, coarse: 1 },
  compose: { ...OBLIQUE, yaw: -14, pitch: 38, left: COLUMN, span: 11.8, shiftY: -0.06, built: 13, coarse: 1 },
  instrument: { ...OBLIQUE, yaw: -4, pitch: 20, fov: 28, frame: 6.6, fit: 12, ty: 2.4, left: COLUMN, span: 13.6, shiftX: -0.05, explode: 0.3, labels: 1, coarse: 1, plan: 0.15 },
  evaluate: { ...OBLIQUE, yaw: 0, pitch: 4, fov: 16, frame: 2.6, tx: 0, ty: 0.55, fit: 12.4, left: COLUMN, span: 12.4, shiftY: 0.1, cut: 1, coarse: 1, plan: 0 },
  refine: { ...OBLIQUE, yaw: 14, pitch: 52, fov: 30, frame: 5.4, fit: 6.4, left: COLUMN, span: 11.8, shiftY: -0.06, coarse: 0, ghost: 1, plan: 0.6 },
  principles: { ...OBLIQUE, yaw: -8, pitch: 14, fov: 12, frame: 4.5, fit: 12.6, ty: 0.55, shiftY: -0.18, plan: 0 },
  frontier: { ...OBLIQUE, yaw: 24, pitch: 12, fov: 34, frame: 7, fit: 11.5, ty: 0.7, shiftX: 0.1, shiftY: 0.05, dusk: 1, plan: 0 },
  // the plate is hidden while the fields are on screen; the camera returns to plan out of sight
  fields: { ...PLAN, frame: 12.6, fit: 12, shiftX: 0.18, shiftY: 0.34, liftN: 0.14, visible: 0 },
  // the arrival's own framing: the record closes where it opened
  resolution: { ...PLAN, frame: 12.6, fit: 12, shiftX: 0.18, shiftY: 0.34, liftN: 0.14 },
  next: { ...PLAN, frame: 14.2, fit: 14.2, left: COLUMN + 80, span: 13.4, shiftY: 0.02, liftN: 0.45, staked: 1 },
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
  const frame = Math.max(s.frame, s.fit / aspect, wide ? (s.span * height) / (width - left) : 0)
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
  ground: hex('#b5b1a8'),
  sheet: hex('#edece7'),
  ink: hex('#1d1d1b'),
  char: hex('#4a3628'),
  blue: hex('#1f2bc0'),
  sky: hex('#b5b1a8'), // the paper colour, so knocked-out copy panels vanish into the sky
  duskGround: hex('#57534b'),
  duskSky: hex('#24231f'),
}
const SUN_DAY = new Vector3(-0.5, 0.75, -0.45).normalize()
const SUN_DUSK = new Vector3(-0.92, 0.2, -0.32).normalize()
const SUN_COL_DAY = new Vector3(1.0, 0.985, 0.96).multiplyScalar(1.7)
const SUN_COL_DUSK = new Vector3(1.0, 0.8, 0.62).multiplyScalar(1.15)
const AMB_DAY = new Vector3(0.93, 0.95, 1.0).multiplyScalar(1.25)
const AMB_DUSK = new Vector3(0.47, 0.46, 0.44).multiplyScalar(0.5) // neutral warm: a blue ambient tinted shadowed sheets icy

const smooth = (t: number) => t * t * (3 - 2 * t)

/** Writes the scene into the plate shader's uniforms. */
export function syncUniforms(u: PlateUniforms, s: SceneState) {
  const d = smooth(Math.min(1, Math.max(0, s.dusk)))
  u.uSunDir.value.lerpVectors(SUN_DAY, SUN_DUSK, d).normalize()
  u.uSunCol.value.lerpVectors(SUN_COL_DAY, SUN_COL_DUSK, d)
  u.uAmbCol.value.lerpVectors(AMB_DAY, AMB_DUSK, d)
  u.uGroundCol.value.copy(PALETTE.ground).lerp(PALETTE.duskGround, d)
  u.uSkyCol.value.copy(PALETTE.sky).lerp(PALETTE.duskSky, d)
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
    uSkyCol: { value: PALETTE.sky.clone() },
    uGroundCol: { value: PALETTE.ground.clone() },
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

/** Cheap fingerprint of everything that changes the picture. */
export function signature(s: SceneState) {
  let h = live.stakes[0] * 7.1 + live.stakes[1] * 8.3 + live.stakes[2] * 9.7 + live.stakes[3] * 10.9 + live.transect.ax * 3.3 + live.transect.az * 5.7 + live.transect.bx * 11.3 + live.transect.bz * 13.1
  let k = 1
  for (const v of Object.values(s)) h += v * (k += 1.618)
  return h
}
