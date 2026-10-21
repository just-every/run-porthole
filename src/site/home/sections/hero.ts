import type { Links } from '../links'
import { check, plate } from '../parts'
import { siteHeader } from '../shell'

// 01, the approved hero C: the open-plan floor of six teams under their
// hanging latency signs (a clean plate: the painted header, copy and cards are
// HTML), "Know why it's slow." / "Fix it fast." and the five cards whose
// records the page follows. Tablets stack the copy, the cards and the floor;
// phones show the floor as its six pods, two to a row, so the painted signs
// stay legible.
const cards = {
  left: [
    'Trace 7f3a…c21 · POST /checkout · Wed Oct 21 · 2:14 pm · <b class="slow">2,310 ms</b>',
    'api-gateway <b class="slow">2,310 ms</b> = auth 40 + checkout-svc 2,250 + edge 20',
  ],
  right: [
    '<b class="slow">1,840</b> of 2,310 ms in one query (80%) · seq scan on orders · index dropped in deploy v412 at 1:58 pm',
    'Monitor fired 2:16 pm Wed Oct 21 → Oncall paged Keisha Grant · root cause posted 2:19 pm with cited queries',
    `p95 checkout 2.3 s vs 800 ms target → rollback to v411 by Dana Brooks 2:22 pm → p95 410 ms at 2:31 pm${check}`,
  ],
}
const floorAlt = 'An open-plan engineering floor on a Wednesday afternoon: six teams, Identity, Checkout, Inventory, Payments, Data and Edge, stand at their whiteboards under hanging signs with their latency, Data’s sign in red at 1,840 ms and its whiteboard reading v411 with a check, and a red dotted trace joins the pods along the floor.'
const card = (text: string) => `<li class="hero-card card"><span>${text}</span></li>`
const arrow = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 10h12.5M11 5l5 5-5 5"/></svg>'

export function hero(links: Links): string {
  const pods = [1, 2, 3, 4, 5, 6].map(i => plate({ name: `hero-pod-${i}`, widths: [236, 472, 708], sizes: '50vw', alt: '', width: 236, height: 324 })).join('')
  return `<section class="hero" aria-labelledby="hero-title">${siteHeader(links)}`
    + `<div class="hero-copy"><h1 id="hero-title"><span class="l1">Know why it’s slow.</span> <span class="l2">Fix it fast.</span></h1>`
    + '<p class="hero-sub">Porthole collects every trace, metric, log and profile, follows each slow request to the query or deploy behind it, readies the fix, and archives your logs in your own bucket.</p>'
    + '<p class="hero-free">100% free, open source alternative to <b>Datadog</b>, <b>New Relic</b> and <b>Grafana Cloud</b></p>'
    + `<div class="hero-actions"><a class="pill" href="${links.run}">Run Porthole${arrow}</a><span class="hero-links"><a class="text-link" href="${links.demo}">Try the demo</a><a class="text-link" href="${links.docs}">Read the docs</a></span></div></div>`
    + `<ul class="hero-cards hero-cards-left" aria-label="The slow request">${cards.left.map(card).join('')}</ul>`
    + `<ul class="hero-cards hero-cards-right" aria-label="Found, paged and fixed">${cards.right.map(card).join('')}</ul>`
    + plate({ name: 'hero', widths: [768, 1152, 1536, 2304, 3072], sizes: '(max-width: 760px) 100vw, min(100vw, 1920px)', alt: floorAlt, cls: 'hero-floor', width: 1536, height: 704, eager: true })
    + `<div class="hero-pods" role="img" aria-label="${floorAlt}">${pods}</div></section>`
}
