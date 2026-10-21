import type { CSSProperties, ReactNode } from 'react'

export interface P95Point { at: number; ms: number; value?: string; time?: string }
export interface P95Props { ticks: string[]; scale?: { at: number; label: string }[]; points?: P95Point[]; max?: number; pin?: { at: number; label: ReactNode }; empty?: string }

const percent = (value: number) => `${(value * 100).toFixed(3)}%`

/** The p95 strip on its own clock axis: ticks spread from the window's start to its end; points are placed by `at`
 *  (0 to 1 along the window) and `ms` against `max` (a label near the window's end reads leftward); the pin drops
 *  a deploy into the rows below. With no points it says `empty` on a dashed baseline. */
export function P95Strip({ ticks, scale = [], points = [], max = 2400, pin, empty = 'No requests yet' }: P95Props) {
  const y = (ms: number) => 1 - Math.min(ms, max) / max
  const line = points.map(point => `${(point.at * 1000).toFixed(1)},${(y(point.ms) * 100).toFixed(2)}`).join(' ')
  return <section className="p95" aria-label="p95 latency">
    <p className="p95-label">p95 latency</p>
    <div className="p95-body">
      <div className="p95-scale" aria-hidden="true">{scale.map(mark => <span key={mark.label} style={{ top: percent(1 - mark.at) }}>{mark.label}</span>)}</div>
      <div className="p95-plot">
        {points.length ? <>
          <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true"><polygon className="p95-area" points={`0,100 ${line} ${points[points.length - 1].at * 1000},100`} /><polyline className="p95-line" points={line} /></svg>
          {points.map(point => <span key={point.at} className="p95-point" style={{ left: percent(point.at), top: percent(y(point.ms)) }} />)}
          {points.filter(point => point.value).map(point => <p key={point.at} className={point.at > .85 ? 'p95-note end' : 'p95-note'} style={{ left: percent(point.at), top: percent(y(point.ms)) } as CSSProperties}><b>{point.value}</b>{point.time}</p>)}
          {pin ? <p className="p95-pin" style={{ left: percent(pin.at) }}><span>{pin.label}</span></p> : null}
        </> : <p className="p95-empty"><span>{empty}</span></p>}
      </div>
    </div>
    <div className="p95-axis" aria-hidden="true">{ticks.map((tick, index) => <span key={tick} style={{ left: percent(index / Math.max(1, ticks.length - 1)) }}>{tick}</span>)}</div>
  </section>
}
