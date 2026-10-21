import branding from '../branding.json'
import { Search } from './icons'
import { initials, roleLabel, type Viewer } from './viewer'

export interface View { label: string; href: string; current?: boolean }
export interface BarQuery { placeholder: string; value?: string; disabled?: boolean }
export interface BarAlert { text: string; fired: boolean }
export interface BarProps { viewer?: Viewer; views?: View[]; query?: BarQuery; range?: string; alert?: BarAlert; home?: string }

/** The approved mark beside the wordmark (data-rer-name: Base adds the Dev and Demo labels). */
export function Lockup({ home }: { home: string }) {
  return <a className="brandmark" href={home}><img src="/brand/mark.svg" alt="" width={44} height={44} /><span data-rer-name="">{branding.name}</span></a>
}

/** A person as initials, name and role; the role is left out when it repeats the name. */
export function Person({ viewer }: { viewer: Viewer }) {
  const name = viewer.displayName, role = roleLabel(viewer.role)
  return <div className="who"><span className="avatar" aria-hidden="true">{initials(name)}</span><span className="who-text"><b>{name}</b>{role !== name ? <small>{role}</small> : null}</span></div>
}

/** The one bar on every screen: the lockup, the views, the query pill and its window, the monitor chip and the
 *  person. Signed out it carries the lockup alone. */
export function AppBar({ viewer, views = [], query, range, alert, home = viewer ? '/app' : '/' }: BarProps) {
  return <header className="topbar">
    <Lockup home={home} />
    {views.length ? <nav className="views" aria-label="Views">{views.map(view => <a key={view.href} href={view.href} aria-current={view.current ? 'page' : undefined}>{view.label}</a>)}</nav> : null}
    {query ? <label className="query"><Search /><span className="sr">Search traces</span><input type="search" name="q" placeholder={query.placeholder} defaultValue={query.value} disabled={query.disabled} /></label> : null}
    {range ? <p className="range">{range}</p> : null}
    {alert ? <p className="alert-chip"><span className={alert.fired ? 'dot' : 'dot idle'} aria-hidden="true" />{alert.text}</p> : null}
    {viewer ? <Person viewer={viewer} /> : null}
  </header>
}
