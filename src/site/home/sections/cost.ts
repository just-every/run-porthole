import { check, head, tag } from '../parts'

// 08, cost control on the page's one pale sea-glass field: checkout.latency's
// active series on Wed Oct 14 (10:00 am – 12:30 pm, every marker at its true
// minute), search-api's logs a day Mon Oct 19 – Fri Oct 30 to scale, and logs
// a day by team from Tue Oct 27 (1,200 GB, was 1,572) in neutral slate steps.
const M = 1_500_000
const sx = (min: number) => min / 150 * 600, sy = (series: number) => 240 - series / M * 240
const curve = `M0 ${sy(2140)}H${sx(20)}C${sx(36)} ${sy(2140)} ${sx(46)} ${sy(1_402_140)} ${sx(60)} ${sy(1_402_140)}H${sx(112)}V${sy(2180)}H${sx(150)}`
const at = (min: number) => `left:${(min / 150 * 100).toFixed(2)}%`
const seriesChart = '<figure class="cost-chart" role="img" aria-label="checkout.latency active series on Wed Oct 14: 2,140 until checkout-svc v405 added user_id at 10:20 am, 1,402,140 by 11:00 am when it was flagged, back to 2,180 after v406 at 11:52 am.">'
  + '<div class="cc-plot"><div class="cc-y" aria-hidden="true">' + [[0, '0'], [500_000, '500K'], [1_000_000, '1M'], [1_500_000, '1.5M']].map(([v, t]) => `<span style="bottom:${(v as number) / M * 100}%">${t}</span>`).join('') + '</div>'
  + `<div class="cc-area" aria-hidden="true"><svg viewBox="0 0 600 240" preserveAspectRatio="none"><path class="cc-grid" d="M0 ${sy(500000)}H600M0 ${sy(1000000)}H600M0 ${sy(1500000)}H600"/><path class="cc-axis" d="M0 240H600"/><path class="cc-line" d="${curve}"/></svg>`
  + `<span class="cc-mark cc-brass" style="${at(20)}"><span class="cc-label cc-l-1020">10:20 am · checkout-svc v405 adds user_id to checkout.latency</span></span>`
  + `<span class="cc-mark cc-brass cc-short" style="${at(60)}"><span class="cc-label cc-l-flag">11:00 am flagged · 40 min</span></span>`
  + `<span class="cc-mark cc-sea cc-short2" style="${at(112)}"><span class="cc-label cc-l-v406">11:52 am · v406<br>2,180 series${check}</span></span>`
  + `<span class="cc-note" style="${at(60)}">2,140 → 1,402,140 series by 11:00 am (+1.4M)</span>`
  + `<span class="cc-dot cc-dot-brass" style="${at(20)};bottom:0"></span><span class="cc-dot cc-dot-brass" style="${at(60)};bottom:${(1_402_140 / M * 100).toFixed(2)}%"></span><span class="cc-dot cc-dot-sea" style="${at(112)};bottom:0"></span>`
  + '</div><div class="cc-x" aria-hidden="true">' + ['10:00 am', '10:30', '11:00', '11:30', '12:00 pm', '12:30 pm'].map((t, i) => `<span style="left:${i * 20}%">${t}</span>`).join('') + `</div></div><ul class="cc-key" aria-hidden="true"><li class="cc-key-brass">10:20 am · checkout-svc v405 adds user_id to checkout.latency</li><li class="cc-key-violet">2,140 → 1,402,140 series by 11:00 am (+1.4M)</li><li class="cc-key-brass">11:00 am flagged · 40 min</li><li class="cc-key-sea">11:52 am · v406 · 2,180 series${check}</li></ul></figure>`

const days = [['Mon', 'Oct 19'], ['Tue', 'Oct 20'], ['Wed', 'Oct 21'], ['Thu', 'Oct 22'], ['Fri', 'Oct 23'], ['Mon', 'Oct 26'], ['Tue', 'Oct 27'], ['Wed', 'Oct 28'], ['Thu', 'Oct 29'], ['Fri', 'Oct 30']]
const bars = '<figure class="log-chart" role="img" aria-label="search-api logs a day: 410 GB each weekday from Mon Oct 19 to Mon Oct 26, 372 GB of it DEBUG; 38 GB a day from Tue Oct 27 to Fri Oct 30.">'
  + '<div class="lc-legend" aria-hidden="true"><span><i class="sw sw-debug"></i>DEBUG</span><span><i class="sw sw-base"></i>INFO · WARN · ERROR</span></div>'
  + '<div class="lc-plot"><div class="cc-y" aria-hidden="true">' + [0, 100, 200, 300, 400].map(v => `<span style="bottom:${v / 440 * 100}%">${v ? `${v} GB` : '0'}</span>`).join('') + '</div>'
  + '<div class="lc-bars" aria-hidden="true">' + days.map(([d, date], i) => `<span class="lc-day${i === 6 ? ' lc-after' : ''}"><span class="lc-stack" style="height:${((i < 6 ? 410 : 38) / 440 * 100).toFixed(2)}%">${i < 6 ? `<span class="lc-debug" style="flex:372"></span>` : ''}<span class="lc-base" style="flex:38"></span></span><span class="lc-date">${d}<br><span class="lc-mon">Oct </span>${date.slice(4)}</span></span>`).join('')
  + `<span class="lc-fixed">Tue Oct 27 · 38 GB a day${check}</span></div></div></figure>`

const teams: [string, number, string][] = [['Edge', 310, '310 GB'], ['Inventory', 260, '260 GB (was 632)'], ['Data', 190, '190 GB'], ['Payments', 180, '180 GB'], ['Identity', 140, '140 GB'], ['Checkout', 120, '120 GB']]
const foot = '<article class="card cost-foot"><h3>Logs a day by team · from Tue Oct 27 · 1,200 GB</h3><div class="cf-row"><ol class="cf-bar">'
  + teams.map(([team, gb, label], i) => `<li style="flex:${gb}" class="cf-seg cf-${i + 1}">${tag(team as never)}<span class="cf-gb">${label}</span><span class="cf-fill" aria-hidden="true"></span></li>`).join('')
  + `</ol><p class="cf-was">was 1,572 GB</p></div><div class="cf-scale" aria-hidden="true">${teams.map(([, gb]) => `<span style="flex:${gb}"></span>`).join('')}</div></article>`

export const cost = (): string => `<section class="sec cost" aria-labelledby="cost-title"><div class="frame">`
  + head({ id: 'cost-title', eyebrow: 'Cost control · Checkout and Inventory · Wed Oct 14 and Mon Oct 26 · ET', line1: '1.4M new series.', line2: 'Caught in 40 minutes.', lead: 'Porthole watches what every team sends. A tag that multiplied one metric and a debug log nobody read were each caught, fixed by a pull request or a rule, and approved by their team.', align: 'center' })
  + '<div class="cost-pair">'
  + `<article class="card cost-panel"><div class="card cost-inner"><p class="cost-title">${tag('Checkout')}<span>checkout.latency · active series · Wed Oct 14</span></p>${seriesChart}</div>`
  + `<div class="cost-text"><p>Agent · 11:04 am · PR #3307: group checkout.latency by route, keep user_id on spans</p><p>searching traces by user_id still works</p><p>Dana Brooks merged · 11:35 am${check}</p></div></article>`
  + `<article class="card cost-panel"><div class="card cost-inner"><p class="cost-title">${tag('Inventory')}<span>search-api · logs a day · Mon Oct 19 – Fri Oct 30</span></p><p class="cost-sub">410 GB a day · 372 GB DEBUG · 0 searches on DEBUG lines Oct 12 – 25</p>${bars}</div>`
  + `<div class="cost-text"><p>Agent · Mon Oct 26, 9:05 am · drop DEBUG from search-api, keep every WARN and ERROR line</p><p>Tomás Rivera approved · 9:40 am${check}</p><p>error lines kept${check}</p></div></article>`
  + '</div>' + foot + '</div></section>'
