import { escape, type RunData } from '../../base/run-site'
import { iconHead } from '../../base/icon-head'
import { homeLinks } from './links'
import { siteFooter } from './shell'
import { keepTogether } from './text'
import { hero } from './sections/hero'
import { serviceMap } from './sections/map'
import { trace } from './sections/trace'
import { incident } from './sections/incident'
import { kubernetes } from './sections/kubernetes'
import { interlude } from './sections/interlude'
import { coverage } from './sections/coverage'
import { cost } from './sections/cost'
import { logs } from './sections/logs'
import { moveIn } from './sections/movein'
import { closing } from './sections/closing'

const title = 'Porthole: know why it’s slow, fix it fast'
const description = 'Porthole collects every trace, metric, log and profile, follows each slow request to the query or deploy behind it, readies the fix, and archives your logs in your own bucket. 100% free, open source alternative to Datadog, New Relic and Grafana Cloud.'

/** The approved homepage (page-s1): the hero, ten sections and the footer, as static HTML. */
export function homePage(run: RunData, styles: string[], contract: boolean): string {
  const links = homeLinks(run, contract)
  const body = hero(links) + '<main id="main">' + [serviceMap(), trace(), incident(), kubernetes(), interlude(), coverage(), cost(), logs(), moveIn(run), closing(links)].join('') + '</main>' + siteFooter(links)
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="theme-color" content="#ffffff">${iconHead}`
    + '<link rel="preload" href="/fonts/porthole/inter-var.woff2" as="font" type="font/woff2" crossorigin>'
    + styles.map(href => `<link rel="stylesheet" href="${escape(href)}">`).join('')
    + `</head><body class="home">${keepTogether(body)}</body></html>`
}
