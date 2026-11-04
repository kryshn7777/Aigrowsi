'use client'

import gsap from 'gsap'
import { useEffect, useMemo, useRef, useState } from 'react'
import { next } from '@/content'
import { live } from '@/specimen/scene'

type Id = (typeof next.fields)[number]['id']
type Brief = Record<Id, string>

const STORE = 'aigrow-system-brief'
const EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? ''
const EMPTY: Brief = { goal: '', constraints: '', users: '', success: '' }

function toMarkdown(brief: Brief) {
  const lines = ['# System brief', '', 'Drafted for AIGROW. Define: the goal, constraints, users, and what success looks like.', '']
  for (const f of next.fields) {
    lines.push(`## ${f.label}`, '', brief[f.id].trim() || '_Not answered yet._', '')
  }
  lines.push('---', '', 'Define, compose, instrument, evaluate, refine.', '')
  return lines.join('\n')
}

/** The next sheet: four Define questions. Each answer drives a stake into the plate; the brief stays local. */
export default function BriefComposer() {
  const [brief, setBrief] = useState<Brief>(EMPTY)
  const [status, setStatus] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORE)
      if (saved) setBrief({ ...EMPTY, ...JSON.parse(saved) })
    } catch {
      // storage unavailable (private mode, blocked): the composer still works for this visit
    }
    loaded.current = true
  }, [])

  useEffect(() => {
    next.fields.forEach((f, k) => {
      const on = brief[f.id].trim() ? 1 : 0
      if (live.stakes[k] !== on) gsap.to(live.stakes, { [k]: on, duration: on ? 0.7 : 0.3, ease: on ? 'power3.out' : 'power1.in' })
    })
    if (!loaded.current) return
    try {
      window.localStorage.setItem(STORE, JSON.stringify(brief))
    } catch {
      // see above
    }
  }, [brief])

  const answered = next.fields.filter((f) => brief[f.id].trim()).length
  const markdown = useMemo(() => toMarkdown(brief), [brief])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown)
      setStatus('Brief copied to the clipboard.')
    } catch {
      setStatus('Copying was blocked by the browser. Use Download brief instead.')
    }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'aigrow-system-brief.md'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('Brief downloaded as aigrow-system-brief.md.')
  }
  const mail = EMAIL
    ? `mailto:${EMAIL}?subject=${encodeURIComponent('AIGROW system brief')}&body=${encodeURIComponent(markdown.slice(0, 1800))}`
    : ''

  return (
    <form className="brief" onSubmit={(e) => e.preventDefault()} aria-describedby="brief-privacy">
      <p className="annot brief-head">
        <span>Layer 14</span>
        <span>
          {answered} of {next.fields.length} stakes driven
        </span>
      </p>
      {next.fields.map((f, k) => (
        <div className="brief-field" key={f.id} data-answered={brief[f.id].trim() ? '' : undefined}>
          <label htmlFor={`brief-${f.id}`}>
            <span className="brief-stake" aria-hidden="true" />
            {f.label}
          </label>
          <textarea
            id={`brief-${f.id}`}
            name={f.id}
            rows={2}
            placeholder={f.hint}
            value={brief[f.id]}
            data-lenis-prevent
            onChange={(e) => {
              const value = e.target.value
              setBrief((b) => ({ ...b, [f.id]: value }))
              setStatus('')
            }}
            aria-describedby={k === 0 ? 'brief-stakes' : undefined}
          />
        </div>
      ))}
      <p className="annot" id="brief-stakes">
        {next.stakes}
      </p>
      <div className="brief-actions">
        <button type="button" className="btn btn--ink" onClick={copy} disabled={!answered}>
          Copy brief
        </button>
        <button type="button" className="btn" onClick={download} disabled={!answered}>
          Download brief
        </button>
        {mail && (
          <a className={`btn${answered ? '' : ' is-disabled'}`} href={answered ? mail : undefined} aria-disabled={!answered}>
            Email brief
          </a>
        )}
      </div>
      <p className="brief-status" role="status">
        {status || (answered ? '' : 'Answer at least one question to export the brief.')}
      </p>
      <p className="annot brief-privacy" id="brief-privacy">
        {mail ? next.privacyEmail : next.privacy}
      </p>
    </form>
  )
}
