'use client'

import gsap from 'gsap'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { Vector3 } from 'three'
import { record } from '@/content'
import { LAYERS, LAYER_H, SUMMIT_H, TOP, sectionProfile, type Profile } from '@/specimen/field'
import { TRANSECT_RECORD, live } from '@/specimen/scene'
import { view } from './Specimen'

const MAX_H = (TOP + 1) * LAYER_H + SUMMIT_H

export function ProfileGraph({ profile, label }: { profile: Profile; label: string }) {
  const W = 320
  const G = 76 // plotted height; the labels live in the extra strip below it, inside the svg, so the readout does not grow a line
  const H = G + 8
  const base = G - 8
  const x = (i: number) => ((i / (profile.heights.length - 1)) * W).toFixed(1)
  const y = (h: number) => (base - (h / MAX_H) * (G - 18)).toFixed(1)
  let d = `M0 ${base}`
  profile.heights.forEach((h, i) => (d += `L${x(i)} ${y(h)}`))
  d += `L${W} ${base}Z`
  return (
    <svg className="profile" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <path d={d} className="profile-solid" />
      <line x1="0" x2={W} y1={base} y2={base} className="profile-base" />
      <text x="0" y={H - 1} className="profile-text">A</text>
      <text x={W} y={H - 1} className="profile-text" textAnchor="end">A′</text>
    </svg>
  )
}

const same = (a: typeof live.transect, b: typeof live.transect) =>
  a.ax === b.ax && a.az === b.az && a.bx === b.bx && a.bz === b.bz

function toPlate(clientX: number, clientY: number): [number, number] | null {
  const cam = view.camera
  if (!cam) return null
  const p = new Vector3((clientX / view.width) * 2 - 1, -(clientY / view.height) * 2 + 1, 0.5).unproject(cam)
  const dir = p.sub(cam.position).normalize()
  if (dir.y > -1e-4) return null
  const t = -cam.position.y / dir.y
  return [cam.position.x + dir.x * t, cam.position.z + dir.z * t]
}

/** The record's instrument: cut a section line across the plate and read the layers it crosses. */
export default function Transect() {
  const [profile, setProfile] = useState<Profile>(() => sectionProfile(TRANSECT_RECORD.ax, TRANSECT_RECORD.az, TRANSECT_RECORD.bx, TRANSECT_RECORD.bz))
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; ax: number; az: number } | null>(null)

  // Follow the line wherever it is moved from (pointer, buttons, scroll choreography) while on screen.
  useEffect(() => {
    const el = surface.current?.closest('section')
    if (!el) return
    let raf = 0
    let seen = { ...live.transect }
    const loop = () => {
      if (!same(seen, live.transect)) {
        seen = { ...live.transect }
        setProfile(sectionProfile(seen.ax, seen.az, seen.bx, seen.bz))
      }
      raf = requestAnimationFrame(loop)
    }
    let demo = false
    const io = new IntersectionObserver(([entry]) => {
      cancelAnimationFrame(raf)
      if (!entry.isIntersecting) return
      raf = requestAnimationFrame(loop)
      if (demo || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      demo = true
      Object.assign(live.transect, TRANSECT_RECORD)
      gsap.fromTo(
        live.transect,
        { bx: TRANSECT_RECORD.ax, bz: TRANSECT_RECORD.az },
        { bx: TRANSECT_RECORD.bx, bz: TRANSECT_RECORD.bz, duration: 1.8, ease: 'power2.inOut', delay: 0.4 },
      )
    })
    io.observe(el)
    return () => {
      io.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])

  const onDown = (e: React.PointerEvent) => {
    const at = toPlate(e.clientX, e.clientY)
    if (!at) return
    gsap.killTweensOf(live.transect)
    drag.current = { id: e.pointerId, ax: at[0], az: at[1] }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const at = toPlate(e.clientX, e.clientY)
    if (!at || Math.hypot(at[0] - d.ax, at[1] - d.az) < 0.25) return
    Object.assign(live.transect, { ax: d.ax, az: d.az, bx: at[0], bz: at[1] })
  }
  const onUp = () => {
    drag.current = null
  }

  const turn = (deg: number) => {
    const t = live.transect
    const cx = (t.ax + t.bx) / 2
    const cz = (t.az + t.bz) / 2
    const c = Math.cos((deg * Math.PI) / 180)
    const s = Math.sin((deg * Math.PI) / 180)
    const rot = (x: number, z: number) => [cx + (x - cx) * c - (z - cz) * s, cz + (x - cx) * s + (z - cz) * c]
    const [ax, az] = rot(t.ax, t.az)
    const [bx, bz] = rot(t.bx, t.bz)
    gsap.to(live.transect, { ax, az, bx, bz, duration: 0.5, ease: 'power2.out' })
  }
  const shift = (amount: number) => {
    const t = live.transect
    const len = Math.hypot(t.bx - t.ax, t.bz - t.az) || 1
    const nx = -(t.bz - t.az) / len
    const nz = (t.bx - t.ax) / len
    gsap.to(live.transect, {
      ax: t.ax + nx * amount,
      az: t.az + nz * amount,
      bx: t.bx + nx * amount,
      bz: t.bz + nz * amount,
      duration: 0.5,
      ease: 'power2.out',
    })
  }
  const reset = () => gsap.to(live.transect, { ...TRANSECT_RECORD, duration: 0.6, ease: 'power2.inOut' })

  const crossed = [...new Set(profile.crossed)].sort((a, b) => b - a)

  return (
    <>
      <div
        ref={surface}
        className="instrument"
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      <div className="readout knock">
        <p className="annot">{record.plate}</p>
        <ProfileGraph profile={profile} label={`Section profile from A to A′, ${profile.length.toFixed(2)} plate units long`} />
        <div className="readout-controls" role="group" aria-label="Move the section line">
          <button type="button" onClick={() => turn(-12)}>Turn left</button>
          <button type="button" onClick={() => turn(12)}>Turn right</button>
          <button type="button" onClick={() => shift(0.35)}>Shift</button>
          <button type="button" onClick={reset}>Reset</button>
        </div>
        <p className="annot readout-count" aria-live="polite">
          {crossed.length === 0
            ? 'The line only crosses bare plate. Start it on a letter.'
            : `Crossed ${crossed.length} of ${TOP + 1} layers, summit first.`}
        </p>
        <ol className="readout-layers">
          <AnimatePresence initial={false}>
            {crossed.map((i) => (
              <motion.li
                key={i}
                layout
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <span className="readout-num">{i + 1}</span>
                <span>
                  <span className="readout-name">{LAYERS[i].name}</span> <span className="readout-note">{LAYERS[i].note}</span>
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      </div>
    </>
  )
}
