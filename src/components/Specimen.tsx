'use client'

import { Canvas, invalidate, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import * as THREE from 'three'
import { DOMAIN, SEGMENTS, fieldAt } from '@/specimen/field'
import { createUniforms, labels, rigCamera, scene, syncUniforms } from '@/specimen/scene'
import { bakeFrag, fullscreenVert, plateFrag } from '@/specimen/shaders'

/** Read by instruments that need to turn a pointer into a plate position. */
export const view = { camera: null as THREE.PerspectiveCamera | null, width: 1, height: 1 }

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

function Plate({ onReady }: { onReady: () => void }) {
  const { gl, camera, setDpr } = useThree()
  const res = useMemo(() => new THREE.Vector2(), [])
  const point = useMemo(() => new THREE.Vector3(), [])
  // two resolution budgets: the plan is cheap and always drawn sharp; the raymarched model adapts
  const perf = useRef({ last: 0, sum: 0, n: 0, dpr: 1, max: 1.5, model: 1 })

  const modelReady = useRef(false)

  const { mesh, uniforms, plan, model } = useMemo(() => {
    const u = createUniforms()
    // the camera's own matrices, by reference: always current when the plate draws
    u.uCamWorld.value = camera.matrixWorld
    u.uProjInv.value = camera.projectionMatrixInverse
    const material = (defines: Record<string, string>) =>
      new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: fullscreenVert,
        fragmentShader: plateFrag,
        uniforms: u,
        defines,
        depthTest: false,
        depthWrite: false,
      })
    const planMat = material({ PLAN: '' })
    const m = fullscreenMesh(planMat)
    m.visible = false
    return { mesh: m, uniforms: u, plan: planMat, model: material({}) }
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
        invalidate()
      })
    return () => {
      cancelled = true
      probes.forEach((p) => p.geometry.dispose())
      field.dispose()
    }
  }, [gl, camera, mesh, plan, model, uniforms, setDpr, onReady])

  useEffect(
    () => () => {
      mesh.geometry.dispose()
      plan.dispose()
      model.dispose()
    },
    [mesh, plan, model],
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
          else {
            uniforms.uShadows.value = 0
            uniforms.uSteps.value = 96
          }
        } else if (avg < 18.5) {
          if (uniforms.uShadows.value === 0) {
            uniforms.uShadows.value = 1
            uniforms.uSteps.value = 160
          } else p.model = Math.min(p.max, p.model + 0.2)
        }
      }
    }
  })

  return <primitive object={mesh} />
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
  }, [])
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="plate-fallback" src="/specimen/plan.svg" alt="" />
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
            gl={{ antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
            onCreated={({ gl }) => {
              gl.setClearColor('#b5b1a8')
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
        <img className="plate-fallback plate-placeholder" src="/specimen/plan.svg" alt="" />
      ) : null}
    </div>
  )
}
