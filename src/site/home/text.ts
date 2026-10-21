// Line-break rules for the homepage's prose, applied to every text run of the
// rendered page (never inside tags, code or pre): a separator or arrow never
// starts a line and a "·" never ends one, and a number keeps its unit, a time
// its am/pm and a month its day.
const NB = ' '
const units = 'ms|s|min|pm|am|GB|GiB|TB|req/s|queries/s|msgs/s|ops/s|jobs/s|days|day'
const rules: [RegExp, string][] = [
  [/ · /g, `${NB}·${NB}`],
  [/ (→|=|\+|−|–|×) /g, `${NB}$1 `],
  [new RegExp(`(\\d[\\d,.]*[MK%]?) (${units})(?=[\\s.,;:)]|$)`, 'g'), `$1${NB}$2`],
  [/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})\b/g, `$1${NB}$2${NB}$3`],
  [/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun|Oct|Nov|Sep) (\d)/g, `$1${NB}$2`],
  [/\b(PR|Q|v) (#?\d)/g, `$1${NB}$2`],
  [/(\d[\d,]*) of (\d[\d,]*)/g, `$1${NB}of${NB}$2`],
  [/\b(p95|p99|to|by|at) (\d)/g, `$1${NB}$2`],
]
export function keepTogether(html: string): string {
  return keepChecks(html.replace(/(<(code|pre|script|style)\b[\s\S]*?<\/\2>)|(<[^>]+>)|([^<]+)/g, (match, raw, _tag, tag, text) => {
    if (raw || tag) return match
    const kept = rules.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text as string)
    // A hyphenated name (payments-svc, orders_customer_id_idx's neighbours) never breaks at its hyphen.
    return kept.replace(/[A-Za-z0-9_.#/]+(?:-[A-Za-z0-9_.#/]+)+/g, word => `<span class="nowrap">${word}</span>`)
  }))
}
// The done check never wraps onto a line of its own: it stays with the word before it.
const keepChecks = (html: string) => html.replace(/([^\s>;]+)(<svg class="ok"[\s\S]*?<\/svg>)/g, '<span class="nowrap">$1$2</span>')
