'use client'

import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { useEffect } from 'react'
import { roots } from '@/specimen/galaxy'
import { STATES, TRANSECT_EVALUATION, cosmosSignature, live, plateSignature, scene, type SceneState, type StateName } from '@/specimen/scene'

const KEYS = Object.keys(STATES.arrival) as (keyof SceneState)[]

/** Tween only what differs between two named states, so neighbouring timelines never fight. */
function move(tl: gsap.core.Timeline, from: StateName, to: StateName, at?: gsap.Position, vars: gsap.TweenVars = {}) {
  const a: Record<string, number> = {}
  const b: Record<string, number> = {}
  for (const k of KEYS) {
    if (STATES[from][k] === STATES[to][k]) continue
    a[k] = STATES[from][k]
    b[k] = STATES[to][k]
  }
  tl.fromTo(scene, a, { ...b, duration: 1, ease: 'power2.inOut', immediateRender: false, ...vars }, at)
}

function approach(trigger: string, from: StateName, to: StateName, start = 'top bottom', end = 'top top') {
  const tl = gsap.timeline({ scrollTrigger: { trigger, start, end, scrub: true } })
  move(tl, from, to)
  return tl
}

/** Pins a sequence of steps; each step owns a scene state and a block of copy. */
function sequence(trigger: string, entry: StateName, hold = 0.4) {
  const steps = gsap.utils.toArray<HTMLElement>(`${trigger} [data-state]`)
  const names = steps.map((s) => s.dataset.state as StateName)
  const marks = gsap.utils.toArray<HTMLElement>(`${trigger} [data-mark]`)
  const starts: number[] = [0]
  const tl = gsap.timeline({
    scrollTrigger: {
      trigger,
      start: 'top top',
      end: () => `+=${window.innerHeight * steps.length}`,
      pin: true,
      scrub: true,
      onUpdate: (self) => {
        const t = self.animation?.time() ?? 0
        let i = 0
        while (i + 1 < starts.length && t >= starts[i + 1]) i++
        marks.forEach((m, k) => m.toggleAttribute('data-active', k === i))
      },
    },
  })
  gsap.set(steps.slice(1), { autoAlpha: 0 })
  move(tl, entry, names[0], 0, { duration: 0.6 })
  steps.forEach((step, i) => {
    tl.to({}, { duration: hold })
    if (i === steps.length - 1) return
    const next = names[i + 1]
    const at = tl.duration()
    move(tl, names[i], next, at, next === 'compose' ? { duration: 1.6, ease: 'none' } : {})
    if (next === 'evaluation') tl.to(live.transect, { ...TRANSECT_EVALUATION, duration: 0.8 }, at)
    tl.to(step, { autoAlpha: 0, duration: 0.25 }, at)
    tl.fromTo(steps[i + 1], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.25, immediateRender: false }, at + 0.45)
    starts.push(at + 0.3)
  })
  marks[0]?.setAttribute('data-active', '')
  return tl
}

export default function Experience() {
  useEffect(() => {
    gsap.registerPlugin(ScrollTrigger)
    const root = document.documentElement
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const plate = document.querySelector<HTMLElement>('.plate')
    const builtEl = document.querySelector<HTMLElement>('[data-built]')
    root.dataset.motion = reduce ? 'reduced' : 'full'
    if (new URLSearchParams(location.search).has('dbg')) (window as unknown as { __aig: unknown }).__aig = { scene, STATES, roots, live }

    const intro = !reduce && window.scrollY < 40
    // single-screen chapters hold still only where they fit on one screen
    const wide = window.matchMedia('(min-width: 901px)').matches
    // the intro dollies in from 42 kpc (log10 = 1.623) to the arrival's distance
    const logD0 = 1.623
    Object.assign(scene, STATES.arrival, { built: intro ? 0 : 13 }, intro ? { cLogD: logD0 } : {})

    let lenis: Lenis | null = null
    const raf = (time: number) => lenis?.raf(time * 1000)
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true })
      lenis.on('scroll', ScrollTrigger.update)
      gsap.ticker.add(raf)
      gsap.ticker.lagSmoothing(0)
    }

    const intros: gsap.core.Tween[] = []
    const endIntro = () => {
      intros.forEach((t) => t.progress(1).kill())
      intros.length = 0
    }
    const ctx = gsap.context(() => {
      if (reduce) {
        // One still frame per passage: no scrubbing, pinning or camera travel.
        gsap.utils.toArray<HTMLElement>('[data-state]').forEach((el) =>
          ScrollTrigger.create({
            trigger: el,
            start: 'top 60%',
            end: 'bottom 40%',
            onToggle: (self) => {
              if (!self.isActive) return
              const name = el.dataset.state as StateName
              Object.assign(scene, name === 'frontier' ? STATES.kerf : STATES[name])
              if (name === 'evaluation') Object.assign(live.transect, TRANSECT_EVALUATION)
            },
          }),
        )
      } else {
        approach('#record', 'arrival', 'record')
        if (wide) {
          // the pin is its own trigger; the galaxy turns under the transect while the sheet is held
          ScrollTrigger.create({ trigger: '#record', start: 'top top', end: '+=100%', pin: true })
          const tl = gsap.timeline({ scrollTrigger: { trigger: '#record', start: 'top top', end: '+=100%', scrub: true } })
          move(tl, 'record', 'recordHold', 0, { ease: 'none' })
        }
        // phones: the plan sits above the copy first, then drops into the gap above the readout once the copy has passed
        if (!wide) approach('.record-text', 'record', 'recordLow', 'bottom 85%', 'bottom 50%')
        approach('#pillars', wide ? 'recordHold' : 'recordLow', 'orchestration', 'top bottom', 'top top')
        sequence('#pillars', 'orchestration')
        approach('#method', 'governance', 'lift')
        sequence('#phases', 'lift', 0.5)
        // the method rebuilds the stack itself; an unfinished arrival must not fight it
        ScrollTrigger.create({ trigger: '#method', start: 'top bottom', onEnter: endIntro })
        approach('#principles', 'refine', 'principles', 'top bottom', wide ? 'top top' : 'top 15%')
        if (wide) ScrollTrigger.create({ trigger: '#principles', start: 'top top', end: '+=60%', pin: true })
        approach('#frontier', 'principles', 'frontier')
        {
          // KERF: the board and sky burn away. Wide pins the sheet; narrow scrubs across its 200svh height.
          // the pin is its own trigger: a pinned scrub timeline renders its from-values at scroll 0 and clobbers the arrival camera
          if (wide) ScrollTrigger.create({ trigger: '#frontier', start: 'top top', end: '+=160%', pin: true })
          const tl = gsap.timeline({
            scrollTrigger: {
              trigger: '#frontier',
              start: 'top top',
              // narrow: the copy panel rises over the model, so the burn must finish while it is still low on screen
              end: wide ? '+=160%' : () => `+=${window.innerHeight * 0.5}`,
              scrub: true,
            },
          })
          move(tl, 'frontier', 'kerf', 0, { ease: 'none' })
        }
        {
          // fade the plate out first (the lock lets go with it), then move the camera back to plan while nobody can see it
          const tl = gsap.timeline({ scrollTrigger: { trigger: '#fields', start: 'top bottom', end: 'top 35%', scrub: true } })
          tl.fromTo(scene, { visible: 1, cLock: 1 }, { visible: 0, cLock: 0, duration: 0.5, ease: 'power1.in', immediateRender: false })
          const { visible: _v, cLock: _l, ...rest } = STATES.fields
          const { visible: _w, cLock: _m, ...from } = STATES.kerf
          void [_v, _l, _w, _m]
          tl.fromTo(scene, from, { ...rest, duration: 0.5, ease: 'none', immediateRender: false })
        }
        // the bottom of the fields: the galaxy falls away into the deep field
        approach('#fields', 'fields', 'deep', 'top 35%', 'bottom bottom')
        approach('#resolution', 'deep', 'resolution', 'top bottom', 'top top')
        // a held beat: the record closes on the same view it opened with, the galaxy easing in a little
        ScrollTrigger.create({ trigger: '#resolution', start: 'top top', end: '+=60%', pin: true })
        {
          const tl = gsap.timeline({ scrollTrigger: { trigger: '#resolution', start: 'top top', end: '+=60%', scrub: true } })
          move(tl, 'resolution', 'resolutionHold', 0, { ease: 'none' })
        }
        approach('#next', 'resolutionHold', 'next', 'top bottom', 'top 30%')
        // once the held beat ends the closing line leaves the screen instead of scrolling through the model
        gsap.fromTo(
          '.resolution-line',
          { autoAlpha: 1 },
          {
            autoAlpha: 0,
            ease: 'none',
            immediateRender: false,
            scrollTrigger: { trigger: '#next', start: 'top bottom', end: 'top 80%', scrub: true },
          },
        )
      }

      // which sheet of the set is on screen
      const links = gsap.utils.toArray<HTMLAnchorElement>('[data-sheet-link]')
      const current = document.querySelector<HTMLElement>('[data-sheet-current]')
      gsap.utils.toArray<HTMLElement>('[data-sheet]').forEach((section) =>
        ScrollTrigger.create({
          // a pinned sheet stays on screen for its whole pin, not just its own height
          trigger: section.parentElement?.classList.contains('pin-spacer') ? section.parentElement : section,
          start: 'top 50%',
          end: 'bottom 50%',
          onToggle: (self) => {
            if (!self.isActive) return
            links.forEach((a) => {
              const on = a.hash === `#${section.id}`
              if (on) a.setAttribute('aria-current', 'location')
              else a.removeAttribute('aria-current')
            })
            if (current) current.textContent = section.dataset.sheet ?? ''
          },
        }),
      )
    })

    const onReady = () => {
      if (intro && window.scrollY < 40) {
        intros.push(gsap.fromTo(scene, { built: 0 }, { built: 13, duration: 3.6, ease: 'power1.inOut', delay: 0.2 }))
      } else if (scene.built < 1) scene.built = 13
    }
    window.addEventListener('specimen:ready', onReady)
    // the dolly starts when the galaxy has its first frame
    const onCosmos = () => {
      if (intro && window.scrollY < 40) intros.push(gsap.fromTo(scene, { cLogD: logD0 }, { cLogD: STATES.arrival.cLogD, duration: 3.6, ease: 'power1.inOut', delay: 0.2 }))
    }
    window.addEventListener('cosmos:ready', onCosmos)

    // Render only when the picture changes; keep the HUD honest about what is drawn.
    let last = Number.NaN
    let lastC = Number.NaN
    let lastBuilt = -1
    let lastY = window.scrollY
    const tick = () => {
      // the wordmark steps aside while reading down the page and returns on the way back up
      const y = window.scrollY
      if (Math.abs(y - lastY) > 6) {
        root.toggleAttribute('data-mast-away', y > lastY && y > window.innerHeight * (window.innerWidth <= 900 ? 0.12 : 0.3))
        lastY = y
      }
      if (y > 40 && intros.length) endIntro()
      const ps = plateSignature(scene)
      const cs = cosmosSignature(scene)
      if (ps === last && cs === lastC) return
      if (cs !== lastC) {
        lastC = cs
        roots.cosmos?.()
      }
      if (ps !== last) {
        last = ps
        if (plate) plate.style.opacity = String(scene.visible)
        if (scene.visible > 0.002) roots.plate?.()
      }
      const built = Math.min(13, Math.floor(scene.built + 0.001))
      if (builtEl && built !== lastBuilt) {
        lastBuilt = built
        builtEl.textContent = String(built)
      }
    }
    gsap.ticker.add(tick)

    // in-page links travel through the story instead of cutting to it, then hand focus over
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]')
      if (!a || a.hash.length < 2) return
      const target = document.querySelector<HTMLElement>(a.hash)
      if (!target) return
      e.preventDefault()
      a.closest('details')?.removeAttribute('open')
      const focus = () => {
        const heading = target.querySelector<HTMLElement>('h1, h2, [data-focus]') ?? target
        heading.setAttribute('tabindex', '-1')
        heading.focus({ preventScroll: true })
        history.replaceState(null, '', a.hash)
      }
      if (lenis) lenis.scrollTo(target, { duration: 1.8, onComplete: focus })
      else {
        target.scrollIntoView()
        focus()
      }
    }
    document.addEventListener('click', onClick)

    document.fonts?.ready.then(() => ScrollTrigger.refresh())

    return () => {
      window.removeEventListener('specimen:ready', onReady)
      window.removeEventListener('cosmos:ready', onCosmos)
      document.removeEventListener('click', onClick)
      gsap.ticker.remove(tick)
      gsap.ticker.remove(raf)
      intros.forEach((t) => t.kill())
      ctx.revert()
      lenis?.destroy()
    }
  }, [])

  return null
}
