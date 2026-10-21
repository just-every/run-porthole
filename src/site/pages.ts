// The run site `rer build --site` writes: the approved homepage at /, whose
// Run Porthole opens /run, the page with the two commands that run Porthole;
// /contract when the seed has a CONTRACT.md; the not-found page; and the
// public files they use. Every Run page string and command is in run.json;
// nothing here reads installation data.
import { contractPageHtml } from '../base/contract-page'
import { runPageHtml, siteNotFoundHtml, type RunData, type SiteBuild, type SiteContext } from '../base/run-site'
import { identity } from '../identity'
import { homePage } from './home/page'
import run from './run.json'
import './home/styles/base.css'
import './home/styles/shell.css'
import './home/styles/hero.css'
import './home/styles/map.css'
import './home/styles/trace.css'
import './home/styles/incident.css'
import './home/styles/kubernetes.css'
import './home/styles/interlude.css'
import './home/styles/coverage.css'
import './home/styles/cost.css'
import './home/styles/logs.css'
import './home/styles/movein.css'
import './home/styles/closing.css'

export function sitePages({ styles = [], contract }: Partial<SiteContext> = {}): SiteBuild {
  const data: RunData = run
  return {
    pages: [
      { path: '/', html: homePage(data, styles, !!contract) },
      { path: '/run', html: runPageHtml(identity, data, contract) },
      ...(contract ? [{ path: '/contract', html: contractPageHtml(identity, data, contract) }] : []),
      { path: '/404', html: siteNotFoundHtml(identity, data, contract) },
    ],
    assets: ['rer-theme.css', 'fonts', 'brand', 'site'],
  }
}
