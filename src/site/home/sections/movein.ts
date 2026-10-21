import type { RunData } from '../../../base/run-site'
import { check, head } from '../parts'

// 10, moving in from Datadog, Mon Oct 12 – Fri Oct 16: the export with the
// three flagged lines ringed in brass, the paired alerts (× 38), the Helm
// values with the three dual-ship entries (one per signal; each wrapped inside
// its flow mapping, and every wrapped value folds back to the same string),
// the cutover and the one-line start.
const ring = (text: string) => `<span class="ringed">${text}</span>`
const exportJson = [
  '{ "monitors": [',
  '  { "name": "ledger sync lag",',
  '    "type": "query alert",',
  `    "query": ${ring('"avg(last_5m):avg:ledger_sync.lag{service:ledger} &gt; 30"')},`,
  '    "tags": ["service:ledger", "team:payments"] },',
  '  { "name": "kafka-main consumer lag",',
  '    "type": "query alert",',
  `    "query": ${ring('"avg(last_5m):max:kafka_lag.messages{service:kafka-main} &gt; 10000"')},`,
  '    "tags": ["service:kafka-main", "team:data"] },',
  '  … ],',
  `  "widgets": [ { ${ring('"q": "avg:ledger_sync.lag{service:ledger}"')} } ] }`,
].join('\n')

// Wide screens: each entry on two lines (the logs value on three). Phones: the
// values wrapped again. Both fold back to the same three values (PyYAML).
const valuesWide = [
  ['', 'datadog:'], ['', '  env:'],
  ['+', '    - {name: DD_ADDITIONAL_ENDPOINTS,'], ['+', `       value: '{"https://porthole-intake": ["porthole"]}'}`],
  ['+', '    - {name: DD_LOGS_CONFIG_ADDITIONAL_ENDPOINTS,'], ['+', `       value: '[{"api_key": "porthole", "Host": "porthole-intake",`], ['+', `         "Port": 443}]'}`],
  ['+', '    - {name: DD_APM_ADDITIONAL_ENDPOINTS,'], ['+', `       value: '{"https://porthole-intake": ["porthole"]}'}`],
]
const valuesPhone = [
  ['', 'datadog:'], ['', '  env:'],
  ['+', '  - {name: DD_ADDITIONAL_ENDPOINTS,'], ['+', `     value: '{"https://porthole-intake":`], ['+', `       ["porthole"]}'}`],
  ['+', '  - {name:'], ['+', '     DD_LOGS_CONFIG_ADDITIONAL_ENDPOINTS,'], ['+', `     value: '[{"api_key": "porthole",`], ['+', `       "Host": "porthole-intake",`], ['+', `       "Port": 443}]'}`],
  ['+', '  - {name: DD_APM_ADDITIONAL_ENDPOINTS,'], ['+', `     value: '{"https://porthole-intake":`], ['+', `       ["porthole"]}'}`],
]
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const yaml = (lines: string[][], cls: string) => `<pre class="yaml ${cls}"><code>${lines.map(([mark, text]) => `<span class="${mark ? 'y-add' : 'y-ctx'}"><span class="y-mark" aria-hidden="true">${mark || ' '}</span>${esc(text)}</span>`).join('')}</code></pre>`

export function moveIn(run: RunData): string {
  return `<section class="sec movein" aria-labelledby="movein-title"><div class="frame">`
    + head({ id: 'movein-title', eyebrow: 'Moving in · from Datadog · Mon Oct 12 – Fri Oct 16 · ET', line1: 'Three lines on 212 hosts.', line2: '38 of 38 alerts matched.', lead: 'Marcus brought the floor’s dashboards, monitors and SLOs across on Monday, and three lines in the Datadog Agent’s Helm values sent all 212 hosts to Porthole too. Every alert fired in both tools all week.', align: 'center' })
    + '<div class="mv-stage">'
    + `<figure class="mv-export"><figcaption class="mono">datadog-export · Mon Oct 12 · 20 dashboards + 50 monitors + 6 SLOs</figcaption><pre><code>${exportJson}</code></pre></figure>`
    + '<figure class="mv-export-phone" aria-hidden="true"><figcaption class="mono"><span>datadog-export · Mon Oct 12</span><span>20 dashboards + 50 monitors + 6 SLOs</span></figcaption>'
    + '<p class="ring-block mono">"query": "avg(last_5m):avg:ledger_sync.<br>lag{service:ledger} &gt; 30",</p>'
    + '<p class="ring-block mono">"query": "avg(last_5m):max:kafka_lag.<br>messages{service:kafka-main} &gt; 10000",</p>'
    + '<p class="ring-block mono">"q": "avg:ledger_sync.lag{service:ledger}"</p></figure>'
    + `<div class="mv-notes hand"><p>67 of 70 translated · 3 flagged: 2 monitors on a custom Agent check, 1 dashboard widget</p><p>fixed by Marcus Reed Tue Oct 13${check}</p><p>6 SLOs, one per team${check}</p></div>`
    + '<div class="mv-alerts"><div class="mv-stack" aria-hidden="true"><span></span><span></span><span></span></div>'
    + '<svg class="clip" viewBox="0 0 48 52" aria-hidden="true"><path d="M13 26L18 5H30L35 26" fill="none" stroke="#a9a8b0" stroke-width="2.6" stroke-linejoin="round"/><path d="M9 24H39L43 50H5Z" fill="#16151b"/><path d="M9 24H39" stroke="#3a3943" stroke-width="2"/></svg>'
    + `<article class="card mv-alert"><h3>payments-svc error rate &gt; 1% · Thu Oct 15</h3><dl><div><dt>Datadog</dt><dd>11:02:05 am</dd></div><div><dt>Porthole</dt><dd>11:02:31 am · 26 s apart${check}</dd></div></dl></article>`
    + '<p class="mv-times hand">× 38</p>'
    + `<p class="mv-caption">38 alerts fired in both, Mon Oct 12 – Fri Oct 16 · each within 1 min · widest gap 48 s${check}</p></div>`
    + `<article class="card mv-values"><p class="mv-values-head"><span class="mono">values.yaml · datadog-agent · datadog.env</span><span>9 clusters · 212 hosts</span></p>${yaml(valuesWide, 'yaml-wide')}${yaml(valuesPhone, 'yaml-phone')}`
    + `<p class="mv-values-foot">Datadog Agent and services’ OpenTelemetry SDKs unchanged · rolled out Mon Oct 12, 11:20 – 11:48 am by Sam Whitaker${check}</p></article>`
    + '</div>'
    + `<div class="mv-foot"><p class="card mv-cutover">Fri Oct 16, 4:00 pm · Agent repointed to Porthole · Porthole’s monitors page through Oncall${check}</p>`
    + `<pre class="terminal" aria-label="Run Porthole"><code><span class="t-prompt" aria-hidden="true">$ </span>${run.clone.split(' ').map(word => `<span class="nowrap">${esc(word)}</span>`).join(' ')}\n<span class="t-ok">✓ Porthole is ready</span></code></pre></div>`
    + '<p class="mv-more">New Relic and Grafana dashboards, monitors and SLOs come across the same way.</p>'
    + '</div></section>'
}
