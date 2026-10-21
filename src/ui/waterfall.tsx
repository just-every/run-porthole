import type { CSSProperties, ReactNode } from 'react'
import { Chevron } from './icons'

/** The waterfall's axis: 0 to 2,400 ms, a tick every 300 ms. */
export const AXIS_MS = 2400
const TICK_MS = 300
const ms = (value: number) => `${value.toLocaleString('en-US')} ms`
const percent = (value: number) => `${(value / AXIS_MS * 100).toFixed(3)}%`

/** One span row. `tone`: path (heliotrope, the selected path), ok (brass, resolved without harm), done (sea glass),
 *  slow (scarlet, only the slow span). A ghost row is where a span will hang: a dashed plate and bar, nothing named. */
export interface Span {
  id: string; depth: number; start: number; end: number
  /** A self-time row ("own", "edge") spends its time in the gaps between its parent's children. */
  segments?: [number, number][]
  team?: string; service?: string; tone?: 'path' | 'ok' | 'done' | 'slow'
  /** Has children: a chevron, open or closed. */
  expandable?: boolean; expanded?: boolean
  /** Under the selected path: the parent's dashed guide runs down its indent. */
  guided?: boolean
  /** The selected span, opened in place; `details` are its evidence cards and the agent's note. */
  open?: boolean; details?: ReactNode
  ghost?: boolean
}

const depth = (span: Span) => ({ '--depth': span.depth }) as CSSProperties
const classes = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

function SpanRow({ span }: { span: Span }) {
  const tone = span.ghost ? undefined : span.tone ?? 'ok'
  const parts = span.segments ?? [[span.start, span.end]]
  const length = parts.reduce((sum, [start, end]) => sum + end - start, 0)
  const last = parts[parts.length - 1][1]
  return <li className={classes('fall-row', span.open && 'open', span.ghost && 'ghost', span.guided && 'guided')} style={depth(span)} aria-hidden={span.ghost || undefined}>
    <div className="fall-name">
      {span.expandable && !span.ghost ? <button className="fall-toggle" type="button" aria-expanded={!!span.expanded} aria-label={`${span.expanded ? 'Collapse' : 'Expand'} ${span.service}`}><Chevron /></button> : <span className="fall-gap" />}
      {span.ghost ? <span className="tag tag-ghost" /> : <span className="tag">{span.team}</span>}
      {span.service ? <span className="svc">{span.service}</span> : null}
      {span.ghost ? null : <span className={classes('dur', tone === 'slow' && 'slow')}>{ms(length)}</span>}
    </div>
    <div className="fall-track">
      {parts.map(([start, end]) => <span key={start} className={classes('fall-bar', span.ghost ? 'ghost' : tone, span.ghost && span.tone === 'path' && 'path')} style={{ left: percent(start), width: percent(end - start) }} />)}
      {span.ghost ? null : <span className={classes('fall-end', tone)} style={{ left: percent(last) }}>{ms(length)}</span>}
    </div>
  </li>
}

/** The waterfall: ticks on a 0–2,400 ms hairline grid, then one row per span in call order, the open span's details
 *  unfolding right under its row and pushing the rest down. */
export function Waterfall({ spans, label }: { spans: Span[]; label: string }) {
  const ticks = Array.from({ length: AXIS_MS / TICK_MS + 1 }, (_, index) => index * TICK_MS)
  return <section className="fall" aria-label={label}>
    <div className="fall-axis" aria-hidden="true"><span /><div className="fall-ticks">{ticks.map(tick => <span key={tick} style={{ left: percent(tick) }}>{tick === AXIS_MS ? ms(tick) : tick.toLocaleString('en-US')}</span>)}</div></div>
    <p className="fall-scale" aria-hidden="true"><span>0</span><span>{ms(AXIS_MS)}</span></p>
    <ol className="fall-rows">{spans.flatMap(span => [
      <SpanRow key={span.id} span={span} />,
      ...(span.open && span.details ? [<li key={`${span.id}-open`} className="fall-open" style={depth(span)}>{span.details}</li>] : []),
    ])}</ol>
  </section>
}
