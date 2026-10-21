import { check, head } from '../parts'

// 04, the page's one failure and recovery on the one ink band: Wed Oct 21,
// 1:58 to 2:31 pm. POST /checkout p95 is drawn on a true time scale (1:50 to
// 2:40 pm) and a true 0–2,400 ms scale from the record's points, every pin at
// its own minute; white under the 800 ms target, scarlet over it, sea glass
// once recovered.
const rail: [string, string, ('slow' | 'ok')?][] = [
  ['1:58', 'v412 deployed · index dropped'],
  ['2:06', 'p95 610 ms · orders-db CPU 41% → 88%'],
  ['2:14', 'p95 840 ms · crossed 800 ms', 'slow'],
  ['2:16', 'monitor fired · Oncall paged Keisha Grant'],
  ['2:17', 'Keisha acknowledged'],
  ['2:19', 'root cause posted, 6 queries cited'],
  ['2:20', 'rollback to v411 readied'],
  ['2:22', 'Dana Brooks approved · Slack', 'ok'],
  ['2:29', 'index rebuilt'],
  ['2:31', 'p95 410 ms · resolved', 'ok'],
]
// Minutes after 1:50 pm and p95 in ms.
const points: [number, number][] = [[0, 420], [8, 430], [16, 610], [24, 840], [30, 2300], [38, 2150], [40, 620], [41, 410], [50, 410]]
const at = (m: number) => { for (let i = 1; i < points.length; i++) { const [m0, v0] = points[i - 1], [m1, v1] = points[i]; if (m <= m1) return v0 + (v1 - v0) * (m - m0) / (m1 - m0) } return 410 }
const X = (m: number) => m * 10, Y = (v: number) => 240 - v / 10
// Split the line where it crosses the target.
const cross = (m0: number, m1: number) => { let lo = m0, hi = m1; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if ((at(mid) > 800) === (at(m0) > 800)) lo = mid; else hi = mid } return lo }
const up = cross(16, 24), down = cross(38, 40)
const seg = (from: number, to: number) => { const ms = [from, ...points.map(p => p[0]).filter(m => m > from && m < to), to]; return ms.map((m, i) => `${i ? 'L' : 'M'}${X(m).toFixed(1)} ${Y(at(m)).toFixed(1)}`).join('') }
const line = `<path class="p-low" d="${seg(0, up)}"/><path class="p-high" d="${seg(up, down)}"/><path class="p-ok" d="${seg(down, 50)}"/>`

// Pins: minute, label, where the label sits.
const pins: [number, string, string][] = [
  [8, '1:58 v412<br>430 ms', 'below'],
  [24, '2:14 · 840 ms<br>crossed 800', 'below-right'],
  [26, '2:16 monitor', 'left'],
  [29, '2:19 root cause', 'left-up'],
  [30, '2:20<span class="pdot"> ·</span><span class="pb"></span> 2.3 s peak', 'above-left'],
  [32, '2:22 approved', 'above-right'],
  [38, '2:28<span class="pdot"> ·</span><span class="pb"></span> 2,150 ms', 'right'],
  [39, '2:29<span class="pb"></span> index rebuilt', 'right-down'],
  [41, `2:31<span class="pdot"> ·</span><span class="pb"></span> 410 ms${check}`, 'ok-right'],
]
const pct = (m: number, v: number) => `left:${(m / 50 * 100).toFixed(2)}%;bottom:${(v / 2400 * 100).toFixed(2)}%`
const pin = ([m, label, place]: [number, string, string]) => `<span class="pin pin-${place}${m >= 41 ? ' pin-ok' : m >= 24 && m <= 39 ? ' pin-high' : ''}" style="${pct(m, at(m))}"><span class="pin-label">${label}</span></span>`

const chart = '<figure class="p95 inc-chart"><figcaption>POST /checkout p95</figcaption><div class="p95-plot" role="img" aria-label="POST /checkout p95 from 1:50 to 2:40 pm: 420 ms at 1:50, 430 at 1:58 when v412 deployed, 610 at 2:06, 840 at 2:14 crossing the 800 ms target, a 2.3 s peak at 2:20, 2,150 at 2:28, 620 at 2:30 and 410 ms at 2:31.">'
  + '<div class="p95-y" aria-hidden="true">' + [0, 800, 1600, 2400].map(v => `<span style="bottom:${v / 24}%">${v ? `${v.toLocaleString('en-US')}${v === 2400 ? ' ms' : ''}` : '0'}</span>`).join('') + '</div>'
  + '<div class="p95-area"><span class="p95-target" style="bottom:33.333%"><span>800 ms target</span></span>'
  + `<svg viewBox="0 0 500 240" preserveAspectRatio="none" aria-hidden="true">${line}</svg>${pins.map(pin).join('')}</div>`
  + '<div class="p95-x" aria-hidden="true">' + ['1:50', '2:00', '2:10', '2:20', '2:30', '2:40'].map((t, i) => `<span style="left:${i * 20}%">${t}<span class="${i === 5 ? '' : 'xpm'}"> pm</span></span>`).join('') + '</div>'
  + '</div></figure>'

const causes: [string, string, string[], boolean?][] = [
  ['1', 'v412 dropped orders_customer_id_idx · seq scan · 1,840 of 2,310 ms (80%) · held', ['Q1', 'Q2', 'Q3', 'Q4'], true],
  ['2', 'Traffic surge · ruled out: 3.1 req/s, same as Monday', ['Q5']],
  ['3', 'Payment provider slow · ruled out: calls unchanged', ['Q1']],
  ['4', 'New errors · ruled out: no new Spool issues', ['Q6']],
  ['5', 'Pod pressure · ruled out: checkout pods at 38% CPU', ['Q4']],
]
const agent = '<article class="card inc-agent"><h3>Agent · 2:19 pm · 5 causes tested · 6 queries cited</h3><ol>'
  + causes.map(([n, text, qs, held]) => `<li class="${held ? 'held' : ''}"><span class="c-dot" aria-hidden="true"></span><span class="c-text">${n} · ${text}</span><span class="qs">${qs.map(q => `<span class="q">${q}</span>`).join('')}</span></li>`).join('')
  + '</ol></article>'
const rollback = '<article class="card inc-rollback"><h3>Rollback readied 2:20 pm</h3><p>checkout-svc → v411 · reverts migration 0412</p><p>rebuilds orders_customer_id_idx without locking writes · about 7 min · no data changed</p>'
  + `<p class="inc-approved">Dana Brooks approved · Slack · 2:22 pm${check}</p></article>`

export const incident = (): string => `<section class="sec incident" aria-labelledby="incident-title"><div class="frame">`
  + head({ id: 'incident-title', eyebrow: 'Incident · Checkout · Wed Oct 21 · 1:58 – 2:31 pm ET', line1: 'Paged at 2:16.', line2: '410 ms by 2:31.', lead: 'The agent tested five causes and posted the one that held, with its queries, three minutes after the page. It readied the rollback, and Dana approved it in Slack.' })
  + '<div class="inc-grid">'
  + `<ol class="inc-rail" aria-label="Minute by minute">${rail.map(([t, text, tone]) => `<li class="${tone ? `is-${tone}` : ''}"><span class="r-dot" aria-hidden="true"></span><span><b class="num">${t}</b> · ${text}${tone === 'ok' ? check : ''}</span></li>`).join('')}</ol>`
  + chart + `<div class="inc-side">${agent}${rollback}</div></div>`
  + `<ul class="inc-tiles"><li><span>p95 2.3 s → 410 ms${check}</span></li><li><span>SLO checkout 99.9% · 43.2 min budget − 11.4 used = 31.8 left${check}</span></li><li><span>Lamp · Checkout · degraded 2:17 → operational 2:32${check}</span></li></ul>`
  + `<p class="inc-foot">2:34 pm · follow-up CHK-482 filed in Vector · Thu Oct 22 · v413 shipped with the index kept${check}</p>`
  + '</div></section>'
