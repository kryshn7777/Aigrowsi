'use client'

import { MotionConfig, motion } from 'motion/react'
import { fields } from '@/content'
import data from '@/specimen/fields.json'

type Drawing = { seed: string; rings: { r: number; d: string }[] }

/** Three smaller specimens: the same growth rule, seeded with the shape of a task instead of a name. */
export default function FieldDrawers() {
  return (
    <MotionConfig reducedMotion="user">
      <div className="drawers">
        {fields.items.map((item) => {
          const drawing = (data.fields as Record<string, Drawing>)[item.id]
          const uncertain = item.id === 'decisions'
          return (
            <figure className="drawer" key={item.id}>
              <svg viewBox={data.viewBox} role="img" aria-label={item.plate}>
                {drawing.rings.map((ring, i) => {
                  const dashed = uncertain && i >= drawing.rings.length - 3
                  const cls = `drawer-ring${(i + 1) % 4 === 0 ? ' drawer-ring--index' : ''}${dashed ? ' drawer-ring--dashed' : ''}`
                  return dashed ? (
                    <motion.path
                      key={i}
                      d={ring.d}
                      className={cls}
                      initial={{ opacity: 0 }}
                      whileInView={{ opacity: 1 }}
                      viewport={{ once: true, margin: '0px 0px -20% 0px' }}
                      transition={{ duration: 0.6, delay: 0.3 + 0.16 * i }}
                    />
                  ) : (
                    <motion.path
                      key={i}
                      d={ring.d}
                      className={cls}
                      initial={{ pathLength: 0 }}
                      whileInView={{ pathLength: 1 }}
                      viewport={{ once: true, margin: '0px 0px -20% 0px' }}
                      transition={{ duration: 1.2, delay: 0.3 + 0.16 * i, ease: [0.25, 0.6, 0.2, 1] }}
                    />
                  )
                })}
                <path d={drawing.seed} className="drawer-seed" />
              </svg>
              <figcaption>
                <h3 className="h3">{item.name}</h3>
                <p>{item.line}</p>
                <p className="annot">{item.plate}</p>
              </figcaption>
            </figure>
          )
        })}
      </div>
    </MotionConfig>
  )
}
