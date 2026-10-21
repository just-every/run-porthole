import type { ReactNode } from 'react'
import branding from '../branding.json'
import { EvidenceIcon } from './icons'
import { initials } from './viewer'

/** The trace card: the trace's title line (its id and route, when, and the total in scarlet when it is the slow one). */
export function TraceCard({ title, when, total, facts }: { title: ReactNode; when?: string; total?: string; facts?: ReactNode }) {
  return <section className="trace-card" aria-label="Trace">
    <h1>{title}</h1>
    {when ? <p className="when">{when}</p> : null}
    {total ? <p className="total">{total}</p> : null}
    {facts ? <p className="facts">{facts}</p> : null}
  </section>
}

export type EvidenceKind = 'query' | 'log' | 'profile' | 'deploy'
const evidenceTitles: Record<EvidenceKind, string> = { query: 'Query', log: 'Log', profile: 'Profile', deploy: 'Deploy' }

/** One of the opened span's four cards: its query, a log line carrying the trace, the profile during the span, and the
 *  deploy behind it. */
export function EvidenceCard({ kind, children }: { kind: EvidenceKind; children: ReactNode }) {
  return <article className="evidence-card card"><h2><EvidenceIcon kind={kind} />{evidenceTitles[kind]}</h2>{children}</article>
}

/** The agent, inline only: a small sea-glass speech tag with the mark. */
export function AgentTag() {
  return <span className="agent-tag"><img src="/brand/mark-32.svg" alt="" width={22} height={22} />{branding.name}</span>
}

/** The agent's note under the opened span: what it says, the person who approves, the actions and one aside. People
 *  approve; Porthole never changes production by itself. */
export function AgentNote({ say, approver, actions, aside }: { say: ReactNode; approver?: { name: string; role: string }; actions?: ReactNode; aside?: ReactNode }) {
  return <aside className="agent-note" aria-label={`${branding.name}’s note`}>
    <AgentTag />
    <div className="agent-say">{say}</div>
    {approver ? <div className="agent-who"><span className="avatar" aria-hidden="true">{initials(approver.name)}</span><span className="who-text"><b>{approver.name}</b><small>{approver.role}</small></span></div> : null}
    {actions ? <div className="agent-actions">{actions}</div> : null}
    {aside ? <p className="agent-aside">{aside}</p> : null}
  </aside>
}
