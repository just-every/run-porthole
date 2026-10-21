import { check, head, tag } from '../parts'

// 07, coverage and noise, Tue Oct 20 – Fri Oct 23: billing-worker before and
// after the agent's PR #1182 (four per-file hunks, +18 −2, merged by Ana Ruiz),
// then the Identity and Edge monitor retunes.
const arrow = '<svg class="cov-arrow" viewBox="0 0 60 16" aria-hidden="true"><path d="M2 8h52M47 2l7 6-7 6"/></svg>'
const file = (name: string, count: string, lines = '') => `<div class="diff-file"><p class="diff-name"><svg viewBox="0 0 12 14" aria-hidden="true"><path d="M1.5 1h6l3 3v9h-9z"/></svg><span class="mono">${name}</span><span class="diff-count">${count}</span></p>${lines}</div>`
const add = (code: string) => `<code class="d-add">${code}</code>`
const ctx = (code: string) => `<code class="d-ctx">${code}</code>`

const pr = `<article class="card cov-pr"><span class="stamp" aria-hidden="true">merged</span><h3>PR #1182 · payments/billing-worker</h3><p class="pr-sub">Add OpenTelemetry tracing and Kafka context propagation</p>`
  + `<p class="pr-meta"><b class="num">+18 −2</b> · opened by the agent Tue Oct 20, 4:10 pm · CI passed${check}</p>`
  + '<div class="diff">'
  + file('requirements.txt', '<span class="plus">+1</span>', `<div class="hunk">${add('+opentelemetry-distro==0.48b0')}</div>`)
  + file('worker/main.py', '<span class="plus">+6</span> <span class="minus">−2</span>')
  + file('worker/consumer.py', '<span class="plus">+10</span>', `<div class="hunk">${add('+from opentelemetry import trace')}${add('+from opentelemetry.propagate import extract')}${add('+tracer = trace.get_tracer("billing-worker")')}<span class="d-break" aria-hidden="true"></span>${ctx('     h = {k: v.decode() for k, v in msg.headers() or []}')}${add('+    with tracer.start_as_current_span("invoice", context=extract(h)):')}</div>`)
  + file('Dockerfile', '<span class="plus">+1</span>', `<div class="hunk">${add('+ENV OTEL_SERVICE_NAME=billing-worker')}</div>`)
  + `</div><p class="pr-merged"><b>Ana Ruiz</b> merged · Thu Oct 22, 10:40 am${check}</p><p class="sr">Merged.</p></article>`

export const coverage = (): string => `<section class="sec coverage" aria-labelledby="coverage-title"><div class="frame">`
  + head({ id: 'coverage-title', eyebrow: 'Coverage and noise · Payments, Identity and Edge · Tue Oct 20 – Fri Oct 23', line1: '45 services traced.', line2: 'Then all 46.', lead: 'billing-worker had sent logs but never a trace. The agent wrote the instrumentation as a pull request, and Ana merged it Thursday.' })
  + '<div class="cov-row">'
  + `<div class="cov-side"><p class="cov-when">Wed Oct 21</p><article class="card cov-before">${tag('Payments')}<h3>billing-worker</h3><p class="dim">Python · Kafka consumer</p><p class="dim">logs only · 0 spans since Mon Oct 12</p></article></div>`
  + arrow + pr + arrow
  + `<div class="cov-side"><p class="cov-when">Thu Oct 22</p><article class="card cov-after">${tag('Payments')}<h3>billing-worker</h3><p class="dim">38 jobs/s · p95 1.2 s · 0.02% errors</p><p class="dim">traces from 11:05 am${check}</p>`
  + `<p class="cov-chip">46 of 46 services traced${check}</p><p class="cov-chip">checkout-svc → payments-svc → invoices.created → billing-worker${check}</p></article></div>`
  + '</div><div class="cov-retunes">'
  + `<article class="card cov-retune">${tag('Identity')}<h3>auth p99 &gt; 150 ms · <span class="nowrap">fired 41 times</span> Oct 12 – 22 · <span class="nowrap">acted on 0</span></h3><p>→ p99 &gt; 250 ms for 10 min</p><p>replayed: 41 → 3, every real slowdown kept${check}</p><p class="cov-pr-line"><b>PR #88</b> · Grace Liu merged Fri Oct 23, 2:10 pm${check}</p></article>`
  + `<article class="card cov-retune">${tag('Edge')}<h3>rate-limiter 5xx &gt; 0.5% · <span class="nowrap">flapped 23 times</span></h3><p>→ judged over 5-minute windows</p><p>replayed: 23 → 1, the real one kept${check}</p><p class="cov-pr-line"><b>PR #89</b> · Sam Whitaker merged Fri Oct 23, 2:25 pm${check}</p></article>`
  + '</div></div></section>'
