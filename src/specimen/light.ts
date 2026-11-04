// Galaxy -> specimen light coupling. The plate and the cosmos are two unrelated cameras, so the core's direction
// "in specimen space" is rebuilt each frame from where the core appears ON SCREEN in the cosmos camera:
// its screen offset from the specimen's own screen centre gives the lateral part, and whether the core is in
// front of (backlight) or behind (front light, dimmer rim) the cosmos camera gives the depth part.
// Pure function of scene state + CSS viewport; module-level temporaries only (no per-frame allocation).
import { Color, PerspectiveCamera, Vector3 } from 'three'
import { cosmosRig } from './galaxy'
import { rigCamera, type SceneState } from './scene'

const spec = new PerspectiveCamera()
const cosm = new PerspectiveCamera()
const pv = new Vector3()
const BULGE = new Color('#ffd6a5')
const ARM = new Color('#b9ccff')
const tint = new Color()
const Z_TERM = 0.7 // depth share of the direction: the core dead centre on screen is mostly behind the stack
const AMB_TINT = 0.35

const ramp = (a: number, b: number, x: number) => Math.min(1, Math.max(0, (x - a) / (b - a)))

/** Writes uRimDir (specimen world space, unit), uRimCol (bulge x clamp(6/d_core, .15, 1.6)) and tints `amb` 35% toward the local galaxy colour. */
export function galaxyLight(s: SceneState, w: number, h: number, rimDir: Vector3, rimCol: Color, amb: Vector3) {
  cosmosRig(cosm, s, w, h)
  rigCamera(spec, s, w, h)
  pv.set(0, 0, 0).applyMatrix4(cosm.matrixWorldInverse) // the core (galaxy origin) in cosmos view space
  const dCore = pv.length()
  const front = pv.z < -1e-3
  let lx: number
  let ly: number
  if (front) {
    const c = cosm.projectionMatrix.elements
    const sc = spec.projectionMatrix.elements
    // lateral screen offset of the core from the specimen's own screen centre (ndc, aspect-corrected)
    lx = ((c[0] * pv.x + c[8] * pv.z) / -pv.z + sc[8]) * (w / h)
    ly = (c[5] * pv.y + c[9] * pv.z) / -pv.z + sc[9]
    const m = Math.hypot(lx, ly)
    if (m > 3) {
      lx *= 3 / m
      ly *= 3 / m
    }
  } else {
    // behind the cosmos camera the projection mirrors: use the true side direction instead
    const m = Math.hypot(pv.x, pv.y) || 1
    lx = (pv.x / m) * 1.5
    ly = (pv.y / m) * 1.5
  }
  rimDir.set(lx, ly, front ? -Z_TERM : Z_TERM).transformDirection(spec.matrixWorld)

  rimCol.copy(BULGE).multiplyScalar(Math.min(1.6, Math.max(0.15, 6 / Math.max(dCore, 1e-3))) * (front ? 1 : 0.4))

  // local galaxy colour: bulge near the core, young-arm blue elsewhere; unit luminance so the ambient level is unchanged
  tint.copy(ARM).lerp(BULGE, 1 - ramp(1.5, 5, Math.hypot(s.cTx, s.cTz)))
  tint.multiplyScalar(1 / (0.2126 * tint.r + 0.7152 * tint.g + 0.0722 * tint.b))
  amb.x *= 1 + AMB_TINT * (tint.r - 1)
  amb.y *= 1 + AMB_TINT * (tint.g - 1)
  amb.z *= 1 + AMB_TINT * (tint.b - 1)
}
