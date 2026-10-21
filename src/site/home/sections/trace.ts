import { head, tag, type Team } from '../parts'

// 03, the slow POST /checkout of Wed Oct 21, 2:14 pm: a poster waterfall on a
// true 0–2,400 ms axis (the record's offsets), the scarlet orders-db span
// ringed, and four notes on dotted leaders from the ring: the query and its
// plan, the log line, the profile and the deploy. Phones get the phone plan's
// span cards on one shared track.
interface Span { team: Team; service: string; op: string; start: number; end: number; slow?: boolean }
const spans: Span[] = [
  { team: 'Edge', service: 'api-gateway', op: 'POST /checkout', start: 0, end: 2310 },
  { team: 'Identity', service: 'auth', op: 'verify session', start: 12, end: 52 },
  { team: 'Checkout', service: 'checkout-svc', op: 'POST /checkout', start: 52, end: 2302 },
  { team: 'Inventory', service: 'inventory-svc', op: 'reserve items', start: 60, end: 180 },
  { team: 'Data', service: 'orders-db', op: 'SELECT orders', start: 180, end: 2020, slow: true },
  { team: 'Payments', service: 'payments-svc', op: 'authorize', start: 2040, end: 2250 },
]
const AXIS = 2400
const pct = (ms: number) => `${(ms / AXIS * 100).toFixed(3)}%`
const ms = (value: number) => `${value.toLocaleString('en-US')} ms`
const cursor = '<svg class="cursor" viewBox="0 0 16 20" aria-hidden="true"><path d="M2 1.5v15l4-3.6 2.6 5.6 2.6-1.2-2.6-5.4h5.4z"/></svg>'

const row = (span: Span) => {
  const length = span.end - span.start
  return `<li class="span${span.slow ? ' span-slow' : ''}"><div class="span-name">${tag(span.team)}<span class="span-op"><span class="nowrap">${span.service}</span> · ${span.op}</span></div>`
    + `<div class="span-track"><span class="span-bar" style="left:${pct(span.start)};width:${pct(length)}"></span>`
    + `<span class="span-dur span-dur-desk" style="left:${pct(span.end)}">${ms(length)}</span>`
    + (span.slow ? `<span class="pill-cursor" style="left:${pct(560)}">${cursor}<span>Keisha · Checkout</span></span>` : '')
    + `</div><span class="span-dur span-dur-phone">${ms(length)}</span></li>`
}
const ticks = [0, 600, 1200, 1800, 2400].map(t => `<span class="tick" style="left:${pct(t)}">${t === AXIS ? '2,400 ms' : t.toLocaleString('en-US')}</span>`).join('')

// Leaders, in desk pixels from the waterfall's top: the ring round the end of
// orders-db (row 5) and four dotted lines fanning down to the notes.
const leaders = '<svg class="wf-leaders" viewBox="0 0 1536 372" aria-hidden="true"><ellipse cx="1314" cy="238" rx="86" ry="25"/>'
  + [[236, 368], [595, 368], [945, 368], [1230, 368]].map(([x, y]) => `<path d="M1282 262L${x} ${y}"/><circle cx="${x}" cy="${y}" r="3"/>`).join('') + '</svg>'

const notes = [
  '<article class="note card"><h3>Top query on orders-db since 1:58 pm</h3><pre class="sql"><span class="nowrap">SELECT id, status, total</span> <span class="nowrap">FROM orders</span>\n<span class="nowrap">WHERE customer_id = $1</span> <span class="nowrap">AND created_at &gt; $2</span></pre>'
    + `<p>Seq Scan on orders · 9,412,077 rows removed by filter · 3 returned</p><p class="note-cursor">${cursor}<span class="pill-cursor-static">Ben · Data</span></p></article>`,
  '<article class="note card"><h3>2:14:07 pm · orders-db · duration: 1840.2 ms</h3><p class="mono">traceparent 00-7f3a…c21</p><p><span class="chip-link">→ this trace</span></p></article>',
  '<article class="note card"><h3>checkout-svc during this span</h3><div class="flame" role="img" aria-label="Profile of checkout-svc during the span: 82% in pgx Query, then the calls to payments-svc and inventory-svc">'
    + '<span class="flame-top">checkout-svc · POST /checkout</span><span class="flame-row"><span class="flame-q">pgx Query</span><span class="flame-g" style="width:9%"></span><span class="flame-g" style="width:5%"></span></span></div>'
    + '<p>97% off-CPU · 82% in pgx Query (1,840 of 2,250 ms)</p></article>',
  '<article class="note card note-deploy"><p class="hand hand-note" aria-hidden="true">index gone in v412<svg viewBox="0 0 30 30"><path d="M24 3c2 9-3 17-15 21M9 24l7 1M9 24l3-6"/></svg></p><h3>checkout-svc v412 · 1:58 pm · GitHub Actions</h3><p>PR #3391 ‘drop unused orders indexes’</p><p>migration 0412 drops orders_customer_id_idx</p><p class="sr">Index gone in v412.</p></article>',
]

export const trace = (): string => `<section class="sec trace" aria-labelledby="trace-title"><div class="frame">`
  + head({ id: 'trace-title', eyebrow: 'Trace · Checkout and Data · Wed Oct 21 · 2:14 pm ET', line1: '2,310 ms.', line2: '1,840 in one query.', lead: 'One click from the slow checkout to its trace, the query that held it, the plan and the deploy that changed it.' })
  + `<div class="wf-block"><div class="wf" role="img" aria-label="Trace 7f3a…c21, POST /checkout, 2,310 ms: api-gateway 0 to 2,310 ms; auth 12 to 52; checkout-svc 52 to 2,302; inventory-svc 60 to 180; orders-db 180 to 2,020, the slow span; payments-svc 2,040 to 2,250.">`
  + `<p class="wf-scale-phone">0 … 2,400 ms</p><div class="wf-axis" aria-hidden="true">${ticks}</div><ol class="spans">${spans.map(row).join('')}</ol></div>`
  + `<p class="wf-share-phone">1,840 of 2,310 ms (80%)</p>${leaders}<div class="notes">${notes.join('')}</div></div>`
  + '<ul class="sums"><li>api-gateway 2,310 = auth 40 + checkout-svc 2,250 + edge 20</li><li>checkout-svc 2,250 = inventory 120 + payments 210 + Postgres 1,840 + own 80</li><li class="sums-share">1,840 of 2,310 ms (80%)</li></ul>'
  + '<p class="compare">Slow traces since 1:58 pm share: db.statement orders by customer_id (100% vs 0% before) · service.version v412 (100%)</p>'
  + '</div></section>'
