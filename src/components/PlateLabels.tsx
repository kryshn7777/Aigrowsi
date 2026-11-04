'use client'

import { useEffect, useRef } from 'react'
import { FUSE, FUSE_TAIL, LAYERS, LAYER_H, RADII, STAKES, SUMMIT_H, reach } from '@/specimen/field'
import { fuseAnchor, labels, layerAnchor, live, scene, stakeAnchor } from '@/specimen/scene'
import data from '@/specimen/specimen.json'

type Spec = {
  text: string
  kind?: 'layer' | 'below' | 'above'
  at: () => readonly [number, number, number]
  opacity: () => number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const SUMMIT_Y = LAYER_H * 13 + SUMMIT_H
const FRONT = reach(-Math.PI / 2 - 0.55, RADII[0] + 0.34)
const ROLLBACK_X = data.wordBounds.maxX + 0.3

const SPECS: Spec[] = [
  ...LAYERS.map((layer, i) => ({
    text: `${i + 1} ${layer.name}`,
    kind: 'layer' as const,
    at: () => layerAnchor(i),
    opacity: () => scene.labels * clamp01(scene.built - i) * scene.visible,
  })),
  ...FUSE.map((f, k) => ({
    text: `${f.pair[0]} + ${f.pair[1]}`,
    kind: FUSE_TAIL[k] > f.z ? ('below' as const) : ('above' as const),
    at: () => fuseAnchor(k),
    opacity: () => scene.fuse,
  })),
  ...['Goal', 'Constraints', 'Users', 'Success'].map((text, k) => ({
    text,
    at: () => stakeAnchor(k),
    opacity: () => scene.staked * clamp01(live.stakes[k] * 2 - 0.6),
  })),
  { text: 'A', at: () => [live.transect.ax, 0, live.transect.az], opacity: () => scene.transect },
  { text: 'A′', at: () => [live.transect.bx, 0, live.transect.bz], opacity: () => scene.transect },
  { text: 'Proposed edge', kind: 'above', at: () => [FRONT[0], 0, FRONT[1] - 0.12], opacity: () => clamp01(scene.front * 2 - 1) },
  { text: 'Operational boundary', kind: 'above', at: () => [-4.1, 0, -2.66], opacity: () => clamp01(scene.bound * 2 - 1) },
  { text: 'Rollback path', at: () => [ROLLBACK_X, SUMMIT_Y, 0], opacity: () => scene.ghost * clamp01(1 - scene.coarse * 1.5) },
  { text: 'Baseline: the plate', at: () => [-5.3, -0.13, 0.02], opacity: () => clamp01(scene.cut * 2 - 1) },
  { text: 'Layer 14, staked', at: () => [STAKES[0][0], 0, STAKES[0][1]], opacity: () => scene.staked * clamp01(1 - live.stakes[0] * 3) },
]

/** Annotations pinned to points on the specimen; positioned by the renderer every frame it draws. */
export default function PlateLabels() {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  useEffect(() => {
    const added = SPECS.map((spec, i) => ({ el: refs.current[i]!, at: spec.at, opacity: spec.opacity }))
    added.forEach((l) => labels.add(l))
    return () => added.forEach((l) => labels.delete(l))
  }, [])
  return (
    <div className="plate-labels" aria-hidden="true">
      {SPECS.map((spec, i) => (
        <span key={i} ref={(el) => void (refs.current[i] = el)} className={spec.kind ? `tag tag--${spec.kind}` : 'tag'}>
          {spec.text}
        </span>
      ))}
    </div>
  )
}
