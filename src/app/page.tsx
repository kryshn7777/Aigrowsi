import BriefComposer from '@/components/BriefComposer'
import Experience from '@/components/Experience'
import FieldDrawers from '@/components/FieldDrawers'
import PlateLabels from '@/components/PlateLabels'
import Specimen from '@/components/Specimen'
import Transect, { ProfileGraph } from '@/components/Transect'
import { architecture, arrival, fields, frontier, method, next, principles, record, resolution, site } from '@/content'
import { sectionProfile } from '@/specimen/field'
import { TRANSECT_EVALUATION } from '@/specimen/scene'

const SHEETS = [
  { id: 'arrival', name: 'Arrival' },
  { id: 'record', name: 'The record' },
  { id: 'architecture', name: 'Architecture' },
  { id: 'method', name: 'The growth loop' },
  { id: 'principles', name: 'Principles' },
  { id: 'frontier', name: 'The frontier' },
  { id: 'fields', name: 'Fields' },
  { id: 'next', name: 'The next layer' },
]

const evaluationProfile = sectionProfile(TRANSECT_EVALUATION.ax, TRANSECT_EVALUATION.az, TRANSECT_EVALUATION.bx, TRANSECT_EVALUATION.bz)

export default function Page() {
  return (
    <>
      <a className="skip" href="#record">
        Skip to the content
      </a>
      <Specimen />
      <noscript>
        <style>{'.knock{background:var(--knock);box-shadow:0 0 1.2rem .8rem var(--knock)}'}</style>
      </noscript>
      <PlateLabels />
      <Experience />

      <header className="mast">
        <a className="wordmark" href="#arrival" aria-label="AIGROW, back to the start">
          AIGROW
        </a>
        <span className="mast-line">The intelligence growth engine</span>
        <nav className="titleblock" aria-label="Sheets">
          <details>
            <summary>
              <span className="tb-current" data-sheet-current>
                Arrival
              </span>
              <span className="tb-built">
                <span data-built>13</span> of 13 layers set
              </span>
            </summary>
            <ol>
              {SHEETS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} data-sheet-link>
                    {s.name}
                  </a>
                </li>
              ))}
            </ol>
          </details>
        </nav>
      </header>

      <main>
        <section id="arrival" className="sheet arrival" data-sheet="Arrival" data-state="arrival">
          <h1 className="display halo">
            {arrival.title.map((line) => (
              <span className="line" key={line}>
                {line}{' '}
              </span>
            ))}
          </h1>
          <div className="arrival-side knock">
            <p className="annot">{arrival.kicker}</p>
            <p className="lede">{arrival.lede}</p>
            <div className="actions">
              <a className="btn btn--ink" href="#architecture">
                {arrival.primary}
              </a>
              <a className="btn" href="#next">
                {arrival.secondary}
              </a>
            </div>
            <p className="annot">{arrival.note}</p>
          </div>
        </section>

        <section id="record" className="sheet record" data-sheet="The record" data-state="record" aria-labelledby="record-title">
          <div className="record-text knock">
            <h2 className="h2" id="record-title">
              {record.title}
            </h2>
            {record.body.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
            <p className="voice">{record.principle}</p>
          </div>
          <Transect />
        </section>

        <section id="architecture" className="sheet architecture" data-sheet="Architecture" aria-labelledby="architecture-title">
          <header className="chapter-head knock">
            <h2 className="h2 halo" id="architecture-title">
              {architecture.title}
            </h2>
            <p className="lede">{architecture.intro}</p>
          </header>
          <div id="pillars" className="steps">
            <ul className="marks" aria-hidden="true">
              {architecture.pillars.map((p) => (
                <li key={p.name} data-mark>
                  {p.name}
                </li>
              ))}
            </ul>
            {architecture.pillars.map((p) => (
              <article key={p.name} className="step knock" data-state={p.state}>
                <h3 className="h3">{p.name}</h3>
                <p className="step-line">{p.line}</p>
                <p>{p.detail}</p>
                {p.state === 'evaluation' && (
                  <ProfileGraph profile={evaluationProfile} label="Section profile through the whole specimen, from A to A′" />
                )}
                <p className="annot">{p.plate}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="method" className="sheet method" data-sheet="The growth loop" aria-labelledby="method-title">
          <header className="chapter-head knock" data-state="lift">
            <h2 className="h2 halo" id="method-title">
              {method.title}
            </h2>
            <p className="lede">{method.lede}</p>
          </header>
          <div id="phases" className="steps">
            <ol className="marks marks--numbered" aria-hidden="true">
              {method.phases.map((p) => (
                <li key={p.name} data-mark>
                  {p.name}
                </li>
              ))}
            </ol>
            {method.phases.map((p, i) => (
              <article key={p.name} className="step knock" data-state={p.state}>
                <h3 className="h3">
                  <span className="step-num">{String(i + 1).padStart(2, '0')}</span> {p.name}
                </h3>
                <p className="step-line">{p.line}</p>
                <p className="annot">{p.plate}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="principles" className="sheet principles" data-sheet="Principles" data-state="principles" aria-labelledby="principles-title">
          <div className="principles-head knock">
            <h2 className="h2" id="principles-title">
              {principles.title}
            </h2>
            <p>{principles.body}</p>
          </div>
          <ul className="principles-list">
            {principles.items.map((p) => (
              <li key={p.name} className="knock">
                <h3 className="h3">{p.name}</h3>
                <p>{p.line}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="frontier" className="sheet frontier" data-sheet="The frontier" data-state="frontier" aria-labelledby="frontier-title">
          <h2 className="h2 frontier-title" id="frontier-title">
            {frontier.title.map((line) => (
              <span className="line" key={line}>
                {line}{' '}
              </span>
            ))}
          </h2>
          <div className="frontier-text knock">
            {frontier.body.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
            <p>{frontier.ambition}</p>
            <p className="frontier-tag">{frontier.tag}</p>
          </div>
        </section>

        <section id="fields" className="sheet fields" data-sheet="Fields" data-state="fields" aria-labelledby="fields-title">
          <header className="chapter-head">
            <h2 className="h2" id="fields-title">
              {fields.title}
            </h2>
            <p className="lede">{fields.intro}</p>
          </header>
          <FieldDrawers />
        </section>

        <section id="resolution" className="sheet resolution" data-sheet="The next layer" data-state="resolution" aria-label={site.tagline}>
          <p className="resolution-line halo">
            <span className="resolution-mark">{resolution.title}</span>
            <span className="line">{resolution.line}</span>
          </p>
        </section>

        <section id="next" className="sheet next" data-sheet="The next layer" data-state="next" aria-labelledby="next-title">
          <div className="next-text knock">
            <p className="annot next-lead">{next.lead}</p>
            <h2 className="h2" id="next-title">
              {next.title}
            </h2>
            <p className="lede">{next.body}</p>
            <p className="next-staked">{next.staked}</p>
          </div>
          <BriefComposer />
        </section>
      </main>

      <footer className="foot knock">
        <p className="foot-line">
          <span className="wordmark">AIGROW</span> {site.tagline}
        </p>
        <p className="annot">
          The plate is drawn live in your browser: thirteen offsets of the AIGROW wordmark, each ring 24% wider than the one inside it.
        </p>
        <p className="annot">© {new Date().getFullYear()} AIGROW</p>
      </footer>
    </>
  )
}
