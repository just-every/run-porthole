import branding from '../branding.json'
import { AppBar, type View } from './bar'
import { Arrow } from './icons'
import { P95Strip } from './strip'
import { AgentNote, EvidenceCard, TraceCard } from './trace'
import { Waterfall, type Span } from './waterfall'
import { isOwner, type Viewer } from './viewer'

export const homePath = '/app'
export const settingsPath = '/auth/settings/identity'

/** The views: the code's real places. Sign-in settings are the owner's alone, so only the owner is offered them. */
export function homeViews(viewer: Viewer, current: string): View[] {
  const views = [{ label: 'Traces', href: homePath }, ...(isOwner(viewer) ? [{ label: 'Settings', href: settingsPath }] : [])]
  return views.map(view => ({ ...view, current: view.href === current }))
}

// Where a trace's spans will hang, as ghosts on the 0–2,400 ms grid: the pick's staircase (a root, its two calls, the
// three calls under the second, the second's own time and the root's edge time), the selected one opened in place.
// Nothing is named and nothing is measured.
const ghosts = (details: Span['details']): Span[] => [
  { id: 'root', depth: 0, start: 0, end: 2310, tone: 'path', ghost: true },
  { id: 'first', depth: 1, start: 12, end: 52, ghost: true },
  { id: 'second', depth: 1, start: 52, end: 2302, tone: 'path', ghost: true },
  { id: 'third', depth: 2, start: 60, end: 180, guided: true, ghost: true },
  { id: 'selected', depth: 2, start: 180, end: 2020, tone: 'path', guided: true, open: true, details, ghost: true },
  { id: 'fifth', depth: 2, start: 2040, end: 2250, guided: true, ghost: true },
  { id: 'own', depth: 2, start: 52, end: 2302, segments: [[52, 60], [2020, 2040], [2250, 2302]], guided: true, ghost: true },
  { id: 'edge', depth: 1, start: 0, end: 2310, segments: [[0, 12], [2302, 2310]], ghost: true },
]

/** /app with nothing collected yet: the trace view's composition, every part in its place and empty. It says what
 *  is true for the person reading it and names nothing that does not exist. */
export function AppHome({ viewer, site }: { viewer: Viewer; site: string }) {
  const works = isOwner(viewer) ? 'Sign-in and settings work today.' : 'Sign-in works today.'
  const details = <>
    <div className="evidence">
      <EvidenceCard kind="query"><div className="code-box ghost" /><p className="quiet">The span’s query and its plan</p></EvidenceCard>
      <EvidenceCard kind="log"><div className="code-box ghost" /><p className="quiet">Log lines that carry the trace</p></EvidenceCard>
      <EvidenceCard kind="profile"><div className="code-box ghost" /><p className="quiet">Where the service spent the span</p></EvidenceCard>
      <EvidenceCard kind="deploy"><div className="code-box ghost" /><p className="quiet">The deploy that came before it</p></EvidenceCard>
    </div>
    <AgentNote
      say={<><b>Nothing to investigate yet.</b> Collecting traces, monitors and {branding.name}’s agent are still being built. {works}</>}
      actions={<><a className="pill pill-sm" href={`${site}/contract`}>See what’s built<Arrow /></a><a className="pill-quiet" href={`${site}/docs`}>Read the docs</a></>} />
  </>
  return <>
    <AppBar viewer={viewer} views={homeViews(viewer, homePath)} query={{ placeholder: 'Search traces', disabled: true }} alert={{ fired: false, text: 'Monitors aren’t built yet' }} />
    <main className="trace-view" id="main">
      <P95Strip ticks={['30 min ago', '25', '20', '15', '10', '5', 'now']} />
      <TraceCard title="No traces yet" facts={`${branding.name} hasn’t received a span.`} />
      <Waterfall label="Trace waterfall: no spans yet" spans={ghosts(details)} />
    </main>
  </>
}
