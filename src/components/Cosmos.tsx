'use client'

import { Canvas, useFrame, useThree, type RootState } from '@react-three/fiber'
import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import {
  COSMOS_DEFAULT,
  FLAGS,
  GAL,
  catalogues,
  flagOff,
  cosmosRig,
  noise3D,
  roots,
  volumeSettings,
  warpGrid,
} from '@/specimen/galaxy'
import { quality, scene } from '@/specimen/scene'
import {
  bulgeFrag,
  bulgeVert,
  compositeFrag,
  deepFrag,
  deepVert,
  fullscreenVert,
  mapBakeFrag,
  marchFrag,
  planeFrag,
  planeVert,
  starFrag,
  starVert,
  volCompFrag,
} from '@/specimen/galaxyShaders'

// The galaxy: its own canvas under the plate, drawn only when invalidated (no idle animation).
// Volume tier (FLAGS.march, tiers 0-4): march -> low-res HalfFloat target (emission, transmittance); then into the full-res HalfFloat target:
//   deep field -> bulge -> volume (dst *= T^k, then dst += emission) -> catalogue stars (own extinction) -> composite to the canvas.
// Disc tier (fallback; shown until the volume program is compiled): [deep field, dust/emission/thick planes + bulge, stars] -> same target.

const MAP = 1024
const PHONE = 900

type Kit = {
  ready: boolean
  /** the ladder's cosmos rungs: how many catalogue stars are drawn (evenly decimated) */
  setStars: (m: number) => void
  stage: (again: () => void) => Promise<void>
  draw: (state: RootState) => void
  dispose: () => void
}

const col = (hex: string) => new THREE.Color(hex)

function buildKit(gl: THREE.WebGLRenderer): Kit {
  const phone = window.innerWidth <= PHONE
  const cat = catalogues(0xc05305, phone ? 50000 : 160000, phone ? 1000 : 2500)
  const ctx = gl.getContext()
  const pointMax = (ctx.getParameter(ctx.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] || 64
  const float = gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float')

  // ---- textures and targets
  const warp = new THREE.DataTexture(warpGrid(256), 256, 256, THREE.RedFormat, THREE.UnsignedByteType)
  warp.minFilter = warp.magFilter = THREE.LinearFilter
  warp.needsUpdate = true
  const mapRT = new THREE.WebGLRenderTarget(MAP, MAP, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: true,
    depthBuffer: false,
  })
  mapRT.texture.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy())
  const size = new THREE.Vector2()
  gl.getDrawingBufferSize(size)
  const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
    type: float ? THREE.HalfFloatType : THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  })
  // volume target: rgb emission, a transmittance; resized to the tier's megapixels
  const volRT = new THREE.WebGLRenderTarget(8, 8, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    generateMipmaps: false,
    depthBuffer: false,
  })
  const noisePlaceholder = new THREE.Data3DTexture(new Uint8Array(2), 1, 1, 1)
  noisePlaceholder.format = THREE.RGFormat
  noisePlaceholder.type = THREE.UnsignedByteType
  noisePlaceholder.needsUpdate = true
  let noiseTex: THREE.Data3DTexture | null = null

  // ---- shared uniforms (colours come from the spec palette; photometry constants are exposure, kept in one place)
  const U: Record<string, THREE.IUniform> = {
    uMap: { value: mapRT.texture },
    uExpo: { value: COSMOS_DEFAULT.cExpo },
    uDpr: { value: 1 },
    uPointMax: { value: pointMax },
    uFocal: { value: 1 },
    // dust: column tau0 = integral of kappa dy (2.4 * 2 * .07 = .336) times a gain, spread over map.g; k_RGB (.72, 1, 1.3)
    uTau0: { value: 0.336 * 1.8 },
    uK: { value: new THREE.Vector3(...GAL.dustK) },
    // surface brightness of old disk / young arms / H-alpha, thick disk relative weight (column .38 split over two planes)
    uOld: { value: 0.3 },
    uYoung: { value: 0.24 },
    uHa: { value: 0.3 },
    uThick: { value: 0.19 },
    uColOld: { value: col('#ffe9d0') },
    uColYoung: { value: col('#b9ccff') },
    uColHII: { value: col('#ff5a7e') },
    uColBulge: { value: col('#ffd6a5') },
    uColCore: { value: col('#ffc2d0') },
    uColRefl: { value: col('#6f8fcf') },
    uIe: { value: 0.45 },
    uNuc: { value: 3 },
    uHalf: { value: 5 },
    uE: { value: 0.9 },
    uGain: { value: 1.6 },
    uSpace: { value: col('#04050a') },
    uScene: { value: rt.texture },
    uWarp: { value: warp },
    // volume march
    uVol: { value: volRT.texture },
    uNoise: { value: noisePlaceholder },
    uInvProj: { value: new THREE.Matrix4() },
    uCamWorld: { value: new THREE.Matrix4() },
    uCamPos: { value: new THREE.Vector3() },
    uSteps: { value: 32 },
    uZero: { value: 0 },
    uOct: { value: 2 },
    uPix: { value: 0.002 },
    uRefl: { value: 0.1 },
  }
  U.uE.value = 0.9 * COSMOS_DEFAULT.cExpo

  const mat = (p: THREE.ShaderMaterialParameters) =>
    new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, uniforms: U, transparent: true, depthTest: false, depthWrite: false, ...p })
  const add = { blending: THREE.AdditiveBlending, premultipliedAlpha: true } as const
  const mEmit = mat({ vertexShader: planeVert, fragmentShader: planeFrag, defines: { EMIT: '' }, side: THREE.DoubleSide, ...add })
  const mThick = mat({ vertexShader: planeVert, fragmentShader: planeFrag, defines: { THICK: '' }, side: THREE.DoubleSide, ...add })
  // absorption: dst *= exp(-tau k_RGB)
  const mDust = mat({
    vertexShader: planeVert,
    fragmentShader: planeFrag,
    defines: { DUST: '' },
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  const mBulge = mat({ vertexShader: bulgeVert, fragmentShader: bulgeFrag, ...add })
  const mStar = mat({ vertexShader: starVert, fragmentShader: starFrag, ...add })
  const mDeep = mat({ vertexShader: deepVert, fragmentShader: deepFrag, ...add })
  const mBake = new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: fullscreenVert, fragmentShader: mapBakeFrag, uniforms: U, depthTest: false, depthWrite: false })
  const mMarch = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    fragmentShader: marchFrag,
    uniforms: U,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })
  // volume onto the main target: first dst *= T^k, then dst += emission
  const mVolMult = mat({
    vertexShader: fullscreenVert,
    fragmentShader: volCompFrag,
    defines: { MULT: '' },
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.ZeroFactor,
    blendDst: THREE.SrcColorFactor,
    blendEquationAlpha: THREE.AddEquation,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  })
  const mVolAdd = mat({ vertexShader: fullscreenVert, fragmentShader: volCompFrag, ...add })
  const mPost = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: fullscreenVert,
    fragmentShader: compositeFrag,
    uniforms: U,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
  })

  // ---- geometry
  const disc = new THREE.CircleGeometry(18, 96)
  disc.rotateX(-Math.PI / 2)
  const quad = new THREE.PlaneGeometry(2, 2)
  const stars = new THREE.BufferGeometry()
  stars.setAttribute('position', new THREE.BufferAttribute(cat.pos, 3))
  stars.setAttribute('aLum', new THREE.BufferAttribute(cat.lum, 1))
  stars.setAttribute('aCol', new THREE.BufferAttribute(cat.col, 4, true))
  const deep = new THREE.BufferGeometry()
  deep.setAttribute('position', new THREE.BufferAttribute(cat.deep.pos, 3))
  deep.setAttribute('aD', new THREE.BufferAttribute(cat.deep.d, 4))
  deep.setAttribute('aCol', new THREE.BufferAttribute(cat.deep.col, 4, true))

  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, y = 0) => {
    const o = new THREE.Mesh(g, m)
    o.position.y = y
    o.frustumCulled = false
    return o
  }
  // ascending y: thick -, dust -, emission, dust +, thick +
  const planes = [mesh(disc, mThick, -0.3), mesh(disc, mDust, -0.05), mesh(disc, mEmit), mesh(disc, mDust, 0.05), mesh(disc, mThick, 0.3)]
  const bulge = mesh(quad, mBulge)
  const points = (g: THREE.BufferGeometry, m: THREE.Material, order: number) => {
    const o = new THREE.Points(g, m)
    o.frustumCulled = false
    o.renderOrder = order
    return o
  }
  const starPts = points(stars, mStar, 100)
  const deepPts = points(deep, mDeep, 0) // behind the galaxy, so its dust absorbs them
  const world = new THREE.Scene()
  world.add(...planes, bulge, starPts, deepPts)
  // volume tier: march pass (into volRT), then the main-target scene: deep field, bulge, volume (T^k then emission), stars
  const marchScene = new THREE.Scene()
  marchScene.add(mesh(quad, mMarch))
  const bulgeV = mesh(quad, mBulge)
  bulgeV.renderOrder = 1
  const volMult = mesh(quad, mVolMult)
  volMult.renderOrder = 2
  const volAdd = mesh(quad, mVolAdd)
  volAdd.renderOrder = 3
  const volScene = new THREE.Scene()
  volScene.add(points(deep, mDeep, 0), bulgeV, volMult, volAdd, points(stars, mStar, 100))
  const bakeScene = new THREE.Scene()
  bakeScene.add(mesh(quad, mBake))
  const post = new THREE.Scene()
  post.add(mesh(quad, mPost))
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)

  // programs are keyed by the target's colour space: compile each scene against the target it will draw into
  const compile = (scene: THREE.Scene, target: THREE.WebGLRenderTarget | null) => {
    gl.setRenderTarget(target)
    const p = gl.compileAsync(scene, ortho).catch(() => undefined)
    gl.setRenderTarget(null)
    return p
  }

  const prevAuto = gl.autoClear
  gl.autoClear = false
  gl.setClearColor(0x000000, 1)
  let disposed = false
  let drawn = false
  let again: () => void = () => undefined
  const parallel = gl.extensions.has('KHR_parallel_shader_compile')
  const vol = { started: false, ready: false }

  // Compile the march program (and its composite) in the background; the disc tier draws until it is ready, then the next frame switches.
  // Without KHR_parallel_shader_compile the link would stall the GPU queue, so it waits until after cosmos:first.
  const startVol = () => {
    if (vol.started || disposed || !float || !FLAGS.march) return
    vol.started = true
    performance.mark('cosmos:vol-compile')
    Promise.all([compile(marchScene, volRT), compile(volScene, rt)]).then(() => {
      if (disposed) return
      const prog = (gl.properties.get(mMarch) as { currentProgram?: { getUniforms: () => unknown; diagnostics?: { runnable?: boolean } } }).currentProgram
      prog?.getUniforms() // runs three's link check (logs the error) on first use
      if (!prog || prog.diagnostics?.runnable === false) return // stay on the discs
      noiseTex = new THREE.Data3DTexture(noise3D(64), 64, 64, 64)
      noiseTex.format = THREE.RGFormat
      noiseTex.type = THREE.UnsignedByteType
      noiseTex.minFilter = noiseTex.magFilter = THREE.LinearFilter
      noiseTex.wrapS = noiseTex.wrapT = noiseTex.wrapR = THREE.RepeatWrapping
      noiseTex.generateMipmaps = false
      noiseTex.needsUpdate = true
      U.uNoise.value = noiseTex
      vol.ready = true
      performance.mark('cosmos:vol-ready')
      again()
    })
  }

  const nStars = cat.pos.length / 3
  const picks = new Map<number, THREE.BufferAttribute>()
  const kit: Kit = {
    ready: false,
    setStars(m) {
      if (m >= nStars) return void stars.setIndex(null)
      let a = picks.get(m)
      if (!a) {
        const idx = new Uint32Array(m)
        for (let i = 0; i < m; i++) idx[i] = Math.floor((i * nStars) / m)
        picks.set(m, (a = new THREE.BufferAttribute(idx, 1)))
      }
      stars.setIndex(a)
    },
    async stage(redraw) {
      again = redraw
      performance.mark('cosmos:stage')
      const bakeC = compile(bakeScene, mapRT)
      const discC = Promise.all([compile(world, rt), compile(post, null)])
      if (parallel) startVol() // compiles in driver threads, queued behind the disc programs
      await bakeC
      performance.mark('cosmos:bakec')
      if (disposed) return
      // the map is baked once, before the first frame
      gl.setRenderTarget(mapRT)
      gl.render(bakeScene, ortho)
      gl.setRenderTarget(null)
      await discC
      performance.mark('cosmos:compiled')
      if (disposed) return
      kit.ready = true
    },
    draw({ camera, size: css }) {
      if (!kit.ready || disposed) return
      quality.feed(performance.now())
      const cam = camera as THREE.PerspectiveCamera
      cosmosRig(cam, scene, css.width, css.height)
      gl.getDrawingBufferSize(size)
      if (rt.width !== size.x || rt.height !== size.y) rt.setSize(size.x, size.y)
      U.uExpo.value = scene.cExpo
      U.uE.value = 0.9 * scene.cExpo
      U.uDpr.value = gl.getPixelRatio()
      U.uFocal.value = cam.projectionMatrix.elements[5] / 2.246 // sprite sizes scale with the lens (1 at fov 48)
      // while the plate marches, the volume is never better than T1
      const vs = volumeSettings(quality.marching ? Math.max(1, quality.tier) : quality.tier, phone)
      if (FLAGS.march && vol.ready && !vs.disc) {
        // volume tier: size the march target from the tier's megapixels (same aspect, never above the canvas)
        const aspect = size.x / size.y
        const h = Math.sqrt((vs.mpx * 1e6) / aspect)
        const k = Math.min(1, size.x / (h * aspect), size.y / h)
        const vw = Math.max(8, Math.round(h * aspect * k))
        const vh = Math.max(8, Math.round(h * k))
        if (volRT.width !== vw || volRT.height !== vh) volRT.setSize(vw, vh)
        U.uInvProj.value.copy(cam.projectionMatrixInverse)
        U.uCamWorld.value.copy(cam.matrixWorld)
        U.uCamPos.value.setFromMatrixPosition(cam.matrixWorld)
        U.uSteps.value = vs.steps
        U.uOct.value = vs.oct
        U.uPix.value = 2 / (cam.projectionMatrix.elements[5] * vh)
        gl.setRenderTarget(volRT) // every pixel is written (no blending), no clear
        gl.render(marchScene, ortho)
        gl.setRenderTarget(rt)
        gl.clear()
        gl.render(volScene, cam)
      } else {
        // far to near so only the dust in front of a layer absorbs it
        const above = cam.position.y >= 0
        planes.forEach((p, i) => (p.renderOrder = 10 + (above ? i : 4 - i)))
        bulge.renderOrder = 12 // with the emission plane, between the two dust planes
        gl.setRenderTarget(rt)
        gl.clear()
        gl.render(world, cam)
      }
      gl.setRenderTarget(null)
      gl.render(post, ortho)
      if (!drawn) {
        drawn = true
        performance.mark('cosmos:first')
        window.dispatchEvent(new Event('cosmos:first'))
        performance.mark('cosmos:ready')
        window.dispatchEvent(new Event('cosmos:ready'))
        if (!parallel) setTimeout(startVol, 0)
      }
    },
    dispose() {
      disposed = true
      kit.ready = false
      gl.autoClear = prevAuto
      ;[disc, quad, stars, deep].forEach((g) => g.dispose())
      ;[mEmit, mThick, mDust, mBulge, mStar, mDeep, mBake, mPost, mMarch, mVolMult, mVolAdd].forEach((m) => m.dispose())
      ;[warp, mapRT, rt, volRT, noisePlaceholder].forEach((t) => t.dispose())
      noiseTex?.dispose()
    },
  }
  return kit
}

function Cosmic() {
  const gl = useThree((s) => s.gl)
  const invalidate = useThree((s) => s.invalidate)
  const css = useThree((s) => s.size)
  const setDpr = useThree((s) => s.setDpr)
  const kit = useRef<Kit | null>(null)

  useEffect(() => {
    const k = buildKit(gl)
    kit.current = k
    const phone = window.innerWidth <= PHONE
    const apply = () => {
      const L = quality.level
      k.setStars(L >= 6 ? 40000 : L >= 4 && !phone ? 80000 : 1e9)
      setDpr(L >= 6 ? 1 : Math.min(1.5, Math.max(1, window.devicePixelRatio || 1)))
      invalidate() // a resized canvas is blank until drawn again
    }
    apply()
    quality.subs.add(apply)
    k.stage(invalidate)
      .catch(() => {
        k.ready = true // draw what compiled; a failed program only costs its own layer
      })
      .then(() => invalidate())
    return () => {
      quality.subs.delete(apply)
      kit.current = null
      k.dispose()
    }
  }, [gl, invalidate, setDpr])

  // a resized canvas is blank until drawn again
  useEffect(() => {
    invalidate()
  }, [css.width, css.height, invalidate])

  // priority > 0 takes rendering into our hands (R3F skips its own gl.render while any subscriber has priority)
  useFrame((state) => kit.current?.draw(state), 1)
  return null
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function Cosmos() {
  const [on, setOn] = useState(false)
  const [lost, setLost] = useState(false)

  useEffect(() => {
    quality.phone = window.innerWidth <= PHONE
    setOn(typeof window.WebGL2RenderingContext !== 'undefined' && !flagOff('cosmos')) // ?cosmos=0: attribution runs
    return () => {
      delete roots.cosmos
    }
  }, [])

  return (
    <div className="cosmos" aria-hidden="true">
      {on && !lost ? (
        <Boundary>
          <Canvas
            flat
            frameloop="demand"
            dpr={[1, 1.5]}
            camera={{ fov: 48, near: 0.005, far: 30000, position: [0, 0, 50], manual: true }}
            gl={{ alpha: false, depth: false, antialias: false, stencil: false, powerPreference: 'high-performance' }}
            onCreated={({ gl, invalidate }) => {
              roots.cosmos = () => invalidate()
              gl.domElement.addEventListener('webglcontextlost', (e) => {
                e.preventDefault()
                delete roots.cosmos
                setLost(true) // the canvas goes; the poster slot (S10) takes over
              })
            }}
          >
            <Cosmic />
          </Canvas>
        </Boundary>
      ) : null}
    </div>
  )
}
