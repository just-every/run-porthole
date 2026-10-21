import { check, head, tag } from '../parts'

// 05, Tue Oct 20 at 3:07 am: search-indexer's memory on a broken time axis
// (2:30–4:00 am, then 9:00–10:00 am, one minute scale and one memory scale),
// the 2 GiB limit stepping to 3 GiB at 9:14, two kills, the 9:15 rerun under
// the new limit, and the event, agent and pull-request cards.
const PER_MIN = 4.667, GAP = 89, A = 90 * PER_MIN
const xa = (m: number) => m * PER_MIN               // minutes after 2:30 am
const xb = (m: number) => A + GAP + m * PER_MIN     // minutes after 9:00 am
const y = (gib: number) => 350 - gib * 100
const W = A + GAP + 60 * PER_MIN
const P = (x: number, g: number) => `${x.toFixed(1)} ${y(g).toFixed(1)}`
const memory = `M${P(xa(0), 1.1)}L${P(xa(37.68), 2)}L${P(xa(37.68), 0)}M${P(xa(38), 0)}L${P(xa(38), 1.1)}L${P(xa(74), 2)}L${P(xa(74), 0)}`
  + `M${P(xb(15), 0)}L${P(xb(16), 1.1)}L${P(xb(46), 2.58)}L${P(xb(50), 2.55)}L${P(xb(52), 2.55)}L${P(xb(52), 0)}`
const limit = `M${P(0, 2)}L${P(A, 2)}M${P(A + GAP, 2)}L${P(xb(14), 2)}L${P(xb(14), 3)}L${P(W, 3)}`
const grid = [0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(g => `M0 ${y(g)}H${A}M${A + GAP} ${y(g)}H${W}`).join('')
  + [xa(30), xa(60), xa(90), xb(0), xb(30), xb(60)].map(x => `M${x.toFixed(1)} 0V350`).join('')
type Seg = 'a' | 'b'
const marks: [Seg, number, number, 'kill' | 'fresh' | 'dot'][] = [['a', xa(0), 1.1, 'dot'], ['a', xa(37.68), 2, 'kill'], ['a', xa(74), 2, 'kill'], ['b', xb(46), 2.58, 'dot'], ['b', xb(52), 0, 'fresh']]
const labels: [Seg, number, number, string, string][] = [
  ['a', xa(0), 1.1, '2:30 am<br>reindex starts · 1.1 GiB', 'kl-start'],
  ['a', xa(37.68), 2, '3:07:41 am<br>OOMKilled · exit 137', 'kl-kill1'],
  ['a', xa(52), 2, 'limit 2 GiB', 'kl-limit brass'],
  ['a', xa(74), 2, '3:44 am<br>OOMKilled · job failed', 'kl-kill2'],
  ['a', xa(38), 0, '3:08 retry', 'kl-retry'],
  ['a', xa(82), 0.62, 'no one woken', 'kl-woken brass'],
  ['b', xb(14), 3, 'limit 3 GiB', 'kl-limit3 brass'],
  ['b', xb(46), 2.58, 'peak 2.58 GiB <br>of 3 GiB', 'kl-peak'],
  ['b', xb(15), 0, '9:15 am<br>rerun', 'kl-rerun'],
  ['b', xb(52), 0, '9:52 am<br>index fresh', 'kl-fresh'],
]
const ticks: [Seg, number, string][] = [['a', xa(30), '3 am'], ['a', xa(60), '3:30 am'], ['a', xa(90), '4 am'], ['b', xb(0), '9 am'], ['b', xb(30), '9:30 am'], ['b', xb(60), '10 am']]
const markSvg = { kill: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6.5 6.5l7 7M13.5 6.5l-7 7"/></svg>', fresh: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M6 10.4l2.8 2.8L14.2 7.4"/></svg>', dot: '' }

// One plot over [x0, x1] desk units: the whole broken axis on wider screens,
// or one side of the break on phones.
function plot(view: 'both' | Seg): string {
  const [x0, x1] = view === 'a' ? [0, A] : view === 'b' ? [A + GAP, W] : [0, W]
  const w = x1 - x0, inView = (seg: Seg) => view === 'both' || view === seg
  const pos = (x: number, g: number) => `left:${((x - x0) / w * 100).toFixed(2)}%;bottom:${(g / 3.5 * 100).toFixed(2)}%`
  const axis = view === 'both' ? `M0 350H${A}M${A + GAP} 350H${W}M0 0V350M${A + GAP} 0V350` : `M${x0} 350H${x1}M${x0} 0V350`
  return `<div class="k-plot k-plot-${view}"><div class="k-y" aria-hidden="true">` + [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map(g => `<span style="bottom:${(g / 3.5 * 100).toFixed(2)}%">${g.toFixed(1)} GiB</span>`).join('') + '</div>'
    + `<div class="k-area" aria-hidden="true"><svg viewBox="${x0.toFixed(1)} 0 ${w.toFixed(1)} 350" preserveAspectRatio="none"><path class="k-grid" d="${grid}"/><path class="k-axis" d="${axis}"/><path class="k-limit" d="${limit}"/><path class="k-mem" d="${memory}"/></svg>`
    + (view === 'both' ? `<span class="k-break k-break-top" style="${pos(A + GAP / 2, 2)}">//</span><span class="k-break k-break-foot" style="${pos(A + GAP / 2, 0)}">//</span>` : '')
    + marks.filter(([seg]) => inView(seg)).map(([, x, g, kind]) => `<span class="k-mark k-${kind}" style="${pos(x, g)}">${markSvg[kind]}</span>`).join('')
    + labels.filter(([seg]) => inView(seg)).map(([, x, g, html, cls]) => `<span class="k-label ${cls}" style="${pos(x, g)}">${html}</span>`).join('')
    + '</div><div class="k-x" aria-hidden="true">' + ticks.filter(([seg]) => inView(seg)).map(([, x, t]) => `<span style="left:${((x - x0) / w * 100).toFixed(2)}%">${t}</span>`).join('') + '</div></div>'
}

const chart = '<figure class="k-chart" role="img" aria-label="search-indexer memory, Tue Oct 20: from 1.1 GiB at 2:30 am to the 2 GiB limit, OOMKilled at 3:07:41 am; the 3:08 retry killed at 3:44 am and the job failed, with no one woken; the limit raised to 3 GiB at 9:14, and the 9:15 am rerun peaked at 2.58 GiB and finished at 9:52 am with a fresh index.">'
  + plot('both') + `<div class="k-phone"><p class="k-when">2:30 – 4:00 am</p>${plot('a')}<p class="k-when">9:00 – 10:00 am</p>${plot('b')}</div></figure>`

export const kubernetes = (): string => `<section class="sec kube" aria-labelledby="kube-title"><div class="frame">`
  + head({ id: 'kube-title', eyebrow: 'Kubernetes · Inventory · Tue Oct 20 · ET', line1: 'Killed at 3:07 am.', line2: 'Resized by standup.', lead: 'The nightly reindex outgrew its memory while search kept serving Monday’s index, so nobody was paged. The agent found why and opened the fix; Tomás merged it at 9:12.', align: 'center' })
  + '<div class="kube-grid">'
  + `<div class="card kube-chart"><div class="kube-pod">${tag('Inventory')}<span class="pod-chip mono">search-indexer-7d9f6-x2kq4 · cluster prod-east-2 · namespace inventory</span></div>${chart}</div>`
  + '<div class="kube-side">'
  + '<article class="card kube-card"><h3>Kubernetes event · OOMKilled</h3><p>3:07:41 am · in Porthole at 3:08:02</p><p>owner: Inventory</p></article>'
  + '<article class="card kube-card"><h3>Agent · 3:12 am · posted to #inventory, not paged</h3><p>Catalog grew 1.84M → 2.41M SKUs since Mon Sep 14 (+31%)</p><p>each run now peaks above the 2 GiB limit</p><p>search-api still serving Monday’s index · no customer impact</p></article>'
  + `<article class="card kube-card"><h3>PR #2207 · search-indexer</h3><p>memory limit 2 GiB → 3 GiB, request 1.5 → 2.5 GiB</p><p>node has 5.2 GiB unrequested${check}</p><p>opened by the agent 3:14 am</p><p>Tomás Rivera merged · 9:12 am${check}</p><p>Argo CD synced 9:14 am</p></article>`
  + '</div></div></div></section>'
