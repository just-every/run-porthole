import { escape } from '../../base/run-site'

// Line-break rules for the docs' prose, never code: a number or range keeps
// its unit and a clock time its am/pm and zone ("3:04 pm AEDT"), a date and a
// count ("0 of 90") stay whole, and a hyphenated word of up to 30 characters
// (sign-in, IF-055-CORE-v1, PORT-039/045/062–065) never breaks at its
// hyphens, as on the homepage, unless it is part of a longer token such as a
// path. A "·", dash, arrow or "×" never starts a line, and "·" never ends one.
// Markdown wraps its source lines anywhere, so any whitespace counts as a
// space. The rules run on escaped text, in one pass so no group is matched
// twice; kept groups use the homepage's .nowrap.
export const NB = ' '
const months = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'
const units = 'ms|s|min|minutes?|seconds?|hours?|days?|weeks?|months?|years?|bytes?|KB|KiB|MB|MiB|GB|GiB|TB|TiB|px|%'
const zone = 'UTC|GMT|[A-Z]{1,4}T'
const groups = new RegExp([
  `\\b\\d{1,2}:\\d{2}(?:\\s*(?:am|pm)(?:\\s+(?:${zone}))?|\\s+(?:${zone}))(?![A-Za-z0-9])`,
  `\\b\\d[\\d,.]*(?:[-–]\\d[\\d,.]*)?\\s+(?:${units})(?![A-Za-z0-9])`,
  `\\b\\d{1,2}\\s+(?:${months})\\b(?:\\s+\\d{4}\\b)?`,
  `\\b(?:${months})\\s+\\d{1,2}\\b(?:,\\s+\\d{4}\\b)?`,
  '\\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{4}\\b',
  '\\b\\d[\\d,]*\\s+of\\s+\\d[\\d,]*\\b',
  '(?<=^|[\\s(])[A-Za-z0-9]+(?:[-–/][A-Za-z0-9]+)*[-–][A-Za-z0-9]+(?:[-–/][A-Za-z0-9]+)*(?=[).,;:!?]*(?:\\s|$))',
].join('|'), 'g')

/** Escape prose for HTML and apply the line-break rules. */
export const prose = (text: string): string => escape(text)
  .replace(groups, group => group.length <= 30 ? `<span class="nowrap">${group.replace(/\s+/g, ' ')}</span>` : group)
  .replace(/\s+·\s+/g, `${NB}·${NB}`)
  .replace(/\s+([—–→×])\s+/g, `${NB}$1 `)
