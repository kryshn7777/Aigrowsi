'use client'

import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { DOMAIN, SEGMENTS, fieldAt } from '@/specimen/field'
import { RIFT, createUniforms, labels, rigCamera, scene, syncUniforms } from '@/specimen/scene'
import { bakeFrag, fullscreenVert, plateFrag, shardFrag, shardVert } from '@/specimen/shaders'

/** Read by instruments that need to turn a pointer into a plate position. */
export const view = { camera: null as THREE.PerspectiveCamera | null, width: 1, height: 1 }

// plain <img> tags are not rewritten by Next, so the sub-path (GitHub Pages) is applied here
const PLAN_SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/specimen/plan.svg`

const BAKE_W = 1024
const BAKE_H = Math.round((BAKE_W * DOMAIN.sizeZ) / DOMAIN.sizeX)

function fullscreenMesh(material: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  return mesh
}

/** Signed distance field of the wordmark, baked once on the GPU (CPU fallback at lower resolution). */
function bakeField(gl: THREE.WebGLRenderer): THREE.Texture {
  if (gl.extensions.has('EXT_color_buffer_float')) {
    const count = SEGMENTS.length / 4
    const width = 256
    const height = Math.ceil(count / width)
    const data = new Float32Array(width * height * 4)
    data.set(SEGMENTS)
    const segTex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.FloatType)
    segTex.needsUpdate = true
    const target = new THREE.WebGLRenderTarget(BAKE_W, BAKE_H, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      generateMipmaps: false,
    })
    const material = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: fullscreenVert,
      fragmentShader: bakeFrag,
      uniforms: {
        uSegs: { value: segTex },
        uSegCount: { value: count },
        uSegWidth: { value: width },
        uDomain: { value: new THREE.Vector4(DOMAIN.minX, DOMAIN.minZ, DOMAIN.sizeX, DOMAIN.sizeZ) },
      },
      depthTest: false,
      depthWrite: false,
    })
    const bakeScene = new THREE.Scene()
    const mesh = fullscreenMesh(material)
    bakeScene.add(mesh)
    gl.setRenderTarget(target)
    gl.render(bakeScene, new THREE.OrthographicCamera())
    gl.setRenderTarget(null)
    mesh.geometry.dispose()
    material.dispose()
    segTex.dispose()
    return target.texture
  }
  const w = 220
  const h = Math.round((w * DOMAIN.sizeZ) / DOMAIN.sizeX)
  const data = new Uint16Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      data[i + j * w] = THREE.DataUtils.toHalfFloat(
        fieldAt(DOMAIN.minX + ((i + 0.5) / w) * DOMAIN.sizeX, DOMAIN.minZ + ((j + 0.5) / h) * DOMAIN.sizeZ),
      )
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.HalfFloatType)
  tex.minFilter = tex.magFilter = THREE.LinearFilter
  tex.needsUpdate = true
  return tex
}

/** KERF shards: start points on the plate, uniform in area density 1/r (r uniform) over the annulus R0..RMAX; deterministic. */
function shardGeometry(count: number) {
  let a = 0x2f6e2b1
  const rnd = () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const cx = DOMAIN.minX + DOMAIN.sizeX / 2
  const cz = DOMAIN.minZ + DOMAIN.sizeZ / 2
  const pos = new Float32Array(count * 3)
  const seed = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const r = RIFT.R0 + (RIFT.RMAX - RIFT.R0) * rnd()
    const th = rnd() * Math.PI * 2
    pos[i * 3] = cx + r * Math.cos(th)
    pos[i * 3 + 2] = cz + r * Math.sin(th)
    seed[i * 4] = rnd()
    seed[i * 4 + 1] = rnd()
    seed[i * 4 + 2] = rnd()
    seed[i * 4 + 3] = rnd()
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4))
  return g
}

function Plate({ onReady }: { onReady: () => void }) {
  const { gl, camera, setDpr } = useThree()
  const res = useMemo(() => new THREE.Vector2(), [])
  const point = useMemo(() => new THREE.Vector3(), [])
  // two resolution budgets: the plan is cheap and always drawn sharp; the raymarched model adapts
  const perf = useRef({ last: 0, sum: 0, n: 0, dpr: 1, max: 1.5, model: 1 })

  const modelReady = useRef(false)
  const shardsReady = useRef(false)

  const { mesh, uniforms, plan, model, shards, shardMat } = useMemo(() => {
    const u = createUniforms()
    // the camera's own matrices, by reference: always current when the plate draws
    u.uCamWorld.value = camera.matrixWorld
    u.uProjInv.value = camera.projectionMatrixInverse
    u.uProj.value = camera.projectionMatrix
    u.uView.value = camera.matrixWorldInverse
    // the model writes gl_FragDepth on every path (always passes), so the shards depth-test against it
    const material = (defines: Record<string, string>) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: fullscreenVert,
        fragmentShader: plateFrag,
        uniforms: u,
        defines,
        depthTest: !('PLAN' in defines),
        depthFunc: THREE.AlwaysDepth,
        depthWrite: !('PLAN' in defines),
      })
    const planMat = material({ PLAN: '' })
    const m = fullscreenMesh(planMat)
    m.visible = false
    const sm = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: shardVert,
      fragmentShader: shardFrag,
      uniforms: u,
      transparent: true,
      blending: THREE.AdditiveBlending,
      premultipliedAlpha: true,
      depthTest: true,
      depthWrite: false,
    })
    const pts = new THREE.Points(shardGeometry(window.innerWidth <= 900 ? 2500 : 7000), sm)
    pts.frustumCulled = false
    pts.renderOrder = 1
    pts.visible = false
    return { mesh: m, uniforms: u, plan: planMat, model: material({}), shards: pts, shardMat: sm }
  }, [camera])

  useEffect(() => {
    let cancelled = false
    const field = bakeField(gl)
    performance.mark('specimen:bake')
    uniforms.uField.value = field
    const max = Math.min(window.devicePixelRatio || 1, 2)
    perf.current.max = max
    perf.current.model = Math.min(max, 1) // full resolution first; the adaptive loop steps down if frames run long
    perf.current.dpr = max
    setDpr(max)
    // Compile off the main thread where KHR_parallel_shader_compile exists: the plan first (it is what
    // the visitor sees first), then the perspective model in the background.
    const probes = [plan, model].map((m) => fullscreenMesh(m))
    const shardProbe = new THREE.Points(shards.geometry, shardMat)
    shardProbe.frustumCulled = false
    const stage = (probe: THREE.Mesh) => {
      const scene = new THREE.Scene()
      scene.add(probe)
      return gl.compileAsync(scene, camera).catch(() => undefined)
    }
    stage(probes[0])
      .then(() => {
        if (cancelled) return
        mesh.visible = true
        invalidate()
        onReady()
        return stage(probes[1])
      })
      .then(() => {
        if (cancelled) return
        // some drivers finish a program on its first draw: pay that once, off-screen, before anyone scrolls in
        const warm = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
        const scene = new THREE.Scene()
        scene.add(probes[1])
        gl.setRenderTarget(warm)
        gl.render(scene, camera)
        gl.setRenderTarget(null)
        warm.dispose()
        performance.mark('specimen:model')
        modelReady.current = true
        document.documentElement.dataset.model = 'on'
        window.dispatchEvent(new Event('specimen:model'))
        invalidate()
        // third stage, after the model is already usable: the shards (own Points probe over the same geometry/material)
        const sScene = new THREE.Scene()
        sScene.add(shardProbe)
        return gl.compileAsync(sScene, camera).catch(() => undefined)
      })
      .then(() => {
        if (cancelled) return
        shardsReady.current = true
        invalidate()
      })
    return () => {
      cancelled = true
      probes.forEach((p) => p.geometry.dispose())
      field.dispose()
    }
  }, [gl, camera, mesh, plan, model, shards, shardMat, uniforms, setDpr, onReady])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      plan.dispose()
      model.dispose()
      shards.geometry.dispose()
      shardMat.dispose()
    },
    [mesh, plan, model, shards, shardMat],
  )

  useFrame(({ size }) => {
    const cam = camera as THREE.PerspectiveCamera
    const { frame, dist } = rigCamera(cam, scene, size.width, size.height)
    gl.getDrawingBufferSize(res)
    uniforms.uResolution.value.copy(res)
    uniforms.uCamPos.value.copy(cam.position)
    uniforms.uPxWorld.value = frame / res.y
    uniforms.uTargetDist.value = dist
    syncUniforms(uniforms, scene)
    // straight down, the plate is read directly; anything else needs the raymarched model
    const marching = modelReady.current && !(scene.pitch > 89.95 && scene.explode < 1e-4)
    mesh.material = marching ? model : plan
    shards.visible = marching && shardsReady.current && scene.rift > 0.1
    const p = perf.current
    const want = marching ? p.model : p.max
    if (want !== p.dpr) {
      p.dpr = want
      p.sum = p.n = 0
      setDpr(want)
      invalidate() // a resized canvas is blank until drawn again
    }
    view.camera = cam
    view.width = size.width
    view.height = size.height

    for (const l of labels) {
      const o = l.opacity()
      if (o <= 0.002) {
        if (l.el.style.opacity !== '0') l.el.style.opacity = '0'
        continue
      }
      const [x, y, z] = l.at()
      point.set(x, y, z).project(cam)
      const sx = (point.x * 0.5 + 0.5) * size.width
      const sy = (-point.y * 0.5 + 0.5) * size.height
      l.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0)`
      l.el.style.opacity = point.z < 1 ? o.toFixed(3) : '0'
    }

    // Adaptive model resolution: only judged while model frames are continuous (scrolling, building).
    const now = performance.now()
    const dt = now - p.last
    p.last = now
    if (marching && dt > 0 && dt < 100) {
      p.sum += dt
      p.n++
      if (p.n >= 36) {
        const avg = p.sum / p.n
        p.sum = p.n = 0
        // a 60 Hz display never beats ~16.7 ms, so "fast" means keeping up with it
        if (avg > 26) {
          if (p.model > 0.6) p.model = Math.max(0.6, p.model - 0.2)
          else if (uniforms.uShadows.value !== 0) {
            uniforms.uShadows.value = 0
            uniforms.uSteps.value = 96
          } else if (uniforms.uRiftQ.value !== 0) {
            // tier 3: no isolines/strata/glow, half the shards
            uniforms.uRiftQ.value = 0
            shards.geometry.setDrawRange(0, shards.geometry.getAttribute('position').count >> 1)
          }
        } else if (avg < 18.5) {
          if (uniforms.uRiftQ.value === 0) {
            uniforms.uRiftQ.value = 1
            shards.geometry.setDrawRange(0, Infinity)
          } else if (uniforms.uShadows.value === 0) {
            uniforms.uShadows.value = 1
            uniforms.uSteps.value = 160
          } else p.model = Math.min(p.max, p.model + 0.2)
        }
      }
    }
  })

  return (
    <>
      <primitive object={mesh} />
      <primitive object={shards} />
    </>
  )
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function Fallback() {
  useEffect(() => {
    document.documentElement.dataset.webgl = 'off'
    if (document.documentElement.dataset.model) {
      delete document.documentElement.dataset.model
      window.dispatchEvent(new Event('specimen:model')) // lets the tone re-check
    }
  }, [])
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="plate-fallback" src={PLAN_SRC} alt="" />
}

export default function Specimen() {
  const [support, setSupport] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const [lost, setLost] = useState(false)

  useEffect(() => {
    let ok = false
    try {
      ok = !!document.createElement('canvas').getContext('webgl2')
    } catch {
      ok = false
    }
    setSupport(ok ? 'yes' : 'no')
  }, [])

  const onReady = useMemo(
    () => () => {
      performance.mark('specimen:ready')
      document.documentElement.dataset.webgl = 'on'
      window.dispatchEvent(new Event('specimen:ready'))
    },
    [],
  )

  // children keep fixed positions across states, so the placeholder (server-rendered, painted with the first frame)
  // stays mounted while the canvas takes over beneath it
  return (
    <div className="plate" aria-hidden="true">
      {support === 'unknown' ? null : support === 'no' || lost ? (
        <Fallback />
      ) : (
        <Boundary fallback={<Fallback />}>
          <Canvas
            frameloop="demand"
            dpr={1}
            camera={{ fov: 3, near: 0.1, far: 1000, position: [0, 150, 0], manual: true }}
            gl={{ antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.setClearColor('#c4bdb0')
              gl.domElement.addEventListener('webglcontextlost', (e) => {
                e.preventDefault()
                setLost(true)
              })
            }}
          >
            <Plate onReady={onReady} />
          </Canvas>
        </Boundary>
      )}
      {/* until the first WebGL frame, the static plan holds the place so the page is never an empty board */}
      {support !== 'no' && !lost ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="plate-fallback plate-placeholder" src={PLAN_SRC} alt="" />
      ) : null}
    </div>
  )
}
