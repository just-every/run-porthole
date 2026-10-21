import { check, head, tag } from '../parts'

// 09, Mon Nov 16: one Payments log line across five stations (raw, parsed,
// masked, hot index, archive to R2 as Parquet), the day's masking counts, and
// Identity answering a SOC 2 auditor from the archive.
const card = (raw: string) => `<span class="pan">${raw}</span>`
const stations: [string, string[]][] = [
  ['Raw', ['payments-svc', '10:41:09 am', 'card verify', `card ${card('4111 1111 1111 1111')}`, 'customer 88412', 'trace 5c2e…a90']],
  ['Parsed', ['level info', 'msg card verify', `card ${card('4111 1111 1111 1111')}`, 'customer_id 88412', 'trace_id 5c2e…a90']],
  ['Masked', ['card •••• •••• •••• 1111', `masked before indexing${check}`]],
  ['Hot index', ['searchable 15 days', '→ trace 5c2e…a90']],
  ['Archive', ['r2://logs-archive/', 'service=payments-svc/', 'date=2026-11-16/', 'Parquet']],
]
const arrow = '<svg class="logs-arrow" viewBox="0 0 40 16" aria-hidden="true"><path d="M2 8h34M30 2l6 6-6 6"/></svg>'

export const logs = (): string => `<section class="sec logs" aria-labelledby="logs-title"><div class="frame">`
  + head({ id: 'logs-title', eyebrow: 'Logs · Payments and Identity · Mon Nov 16 · ET', line1: 'Card numbers masked.', line2: 'Logs in your own bucket.', lead: 'Every line is parsed, masked and linked to its trace on the way in. Fifteen days stay hot; the rest lives in your R2 bucket as Parquet, readable without Porthole.' })
  + `<ol class="stations">${stations.map(([name, lines]) => `<li class="station"><h3>${name}</h3><span class="st-dot" aria-hidden="true"></span><div class="card slip">${tag('Payments')}<p class="slip-lines">${lines.map(l => `<span>${l}</span>`).join('')}</p></div></li>`).join('')}</ol>`
  + `<ul class="logs-chips"><li><span>1.2 TB a day from 46 services</span></li><li><span>Mon Nov 16 · 21,340 card numbers and 2,906 SSNs masked</span></li><li><span>raw storage searched for card and SSN patterns: 0 found${check}</span></li></ul>`
  + '<div class="audit">'
  + `<article class="card audit-card">${tag('Identity')}<h3>Mon Nov 16, 10:00 am</h3><p>SOC 2 auditor asks for failed admin logins, Tue Oct 13 – Thu Oct 15.</p></article>${arrow}`
  + `<article class="card audit-card">${tag('Identity')}<h3>Grace Liu · 10:02 am</h3><p>auth logs Oct 13 – 15 · 96 GB from R2.</p><p>searchable at 10:08:40 am · 6 min 40 s${check}</p><p>auditor role: read-only, auth logs only.</p></article>${arrow}`
  + `<article class="card audit-card">${tag('Identity')}<h3>DuckDB on the bucket.</h3><p>the same days read straight from R2.</p><p>37 failed admin logins · same count in Porthole${check}</p><p>sent to Evidence${check}</p></article>`
  + '</div></div></section>'
