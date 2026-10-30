import { invalid } from '../ingest/model'
import { maxBytes } from '../ingest/wire'

export interface RedactionRule { pattern: string; exceptions: string[] }
const mask = '[REDACTED]'
// Attribute names may carry an OTLP semantic-convention or header prefix.
// A sensitive leaf remains sensitive when qualified, including numeric values.
const sensitiveName = 'authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|api[-_]?key|x[-_](?:api[-_]?key|auth[-_]?token|amz[-_]security[-_]token|goog[-_]api[-_]key)|ocp[-_]apim[-_]subscription[-_]key|secret[-_]?access[-_]?key|access[-_]?key|private[-_]?key|session[-_]?(?:id|token)|(?:access|refresh|auth|bearer|id)[-_]?token|token|ssn|social[-_]?security[-_]?(?:number|no)|(?:credit[-_]?card|card|cc)[-_]?(?:number|no)|phone(?:[-_]?number)?|telephone'
const secretKey = new RegExp('(?:^|\\.)(?:'+sensitiveName+')$', 'i')
const contextualSecret = new RegExp('(\\b(?:'+sensitiveName+')[\"\']?\\s*[=:]\\s*[\"\']?)[^\\s,\"\';}]{1,2048}', 'gi')

// Exact-width atoms make matching linear; no groups, alternatives or variable repeats.
export function customPattern(pattern: string): RegExp {
 const bad = (): never => invalid('invalid_redaction_rule', 400)
 if (typeof pattern !== 'string' || !pattern.length || pattern.length > 256) return bad()
 let cursor = 0, width = 0, expression = ''
 while (cursor < pattern.length) {
  let atom: string
  if (pattern[cursor] === '[') {
   const end = pattern.indexOf(']', cursor), token = pattern.slice(cursor, end + 1)
   if (!['[A-Z]','[a-z]','[0-9]','[A-Za-z]','[A-Za-z0-9]','[a-z0-9]'].includes(token)) return bad()
   atom = token; cursor = end + 1
  } else if (pattern[cursor] === '\\') {
   const literal = pattern[++cursor]
   if (!literal || !'.+*?()[]{}^$|\\'.includes(literal)) return bad()
   atom = `\\${literal}`; cursor++
  } else {
   const literal = pattern[cursor++]
   if (!/^[A-Za-z0-9 _:@/-]$/.test(literal)) return bad()
   atom = literal
  }
  let count = 1
  if (pattern[cursor] === '{') {
   const end = pattern.indexOf('}', cursor), raw = pattern.slice(cursor + 1, end)
   if (end < 0) return bad()
   if (!/^[1-9][0-9]?$/.test(raw) || Number(raw) > 64) return bad()
   count = Number(raw); cursor = end + 1
  }
  width += count
  if (width > 256) return bad()
  expression += `${atom}{${count}}`
 }
 return new RegExp(expression, 'g')
}
export function redactionRules(input: unknown): RedactionRule[] {
 if (!Array.isArray(input) || input.length > 16) return invalid('invalid_redaction_rule', 400)
 return input.map(raw => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid('invalid_redaction_rule', 400)
  const d = raw as Record<string, unknown>
  if (Object.keys(d).some(k => !['pattern','exceptions'].includes(k)) || typeof d.pattern !== 'string' || !Array.isArray(d.exceptions) || d.exceptions.length > 32 || d.exceptions.some(v => typeof v !== 'string' || !v.length || v.length > 256)) return invalid('invalid_redaction_rule', 400)
  customPattern(d.pattern)
  return { pattern:d.pattern, exceptions:[...new Set(d.exceptions as string[])] }
 })
}
function string(value: string, custom: { regex:RegExp; exceptions:string[] }[], identifiers: boolean): string {
 // Accepted wire is already bounded. Scan that supported range instead of
 // replacing a harmless large body wholesale, which would silently lose data.
 if (value.length > maxBytes) return invalid('redaction_input_too_large',413)
 for (const rule of custom) value = value.replace(rule.regex, match => rule.exceptions.includes(match) ? match : mask)
 value = value
  .replace(/-----BEGIN [A-Z ]{0,40}PRIVATE KEY-----[\s\S]*?-----END [A-Z ]{0,40}PRIVATE KEY-----/g, mask)
  .replace(/\b(?:Bearer|Basic)\s{1,32}[A-Za-z0-9+/_=.-]{1,8192}/gi, mask)
  .replace(/\beyJ[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,8192}(?:\.[A-Za-z0-9_-]{0,2048})?/g, mask)
  .replace(/\b(?:sk|pk|rk)[-_](?:(?:live|test|proj)[-_])?[A-Za-z0-9_-]{8,256}\b/g, mask)
  .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, mask)
  .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]{12,255}|github_pat_[A-Za-z0-9_]{12,255}|xox[baprs]-[A-Za-z0-9-]{8,255}|AIza[A-Za-z0-9_-]{20,100})\b/g, mask)
  .replace(contextualSecret, (_all, prefix: string) => prefix + mask)
  .replace(/(^|[^0-9])\d{3}[- ]\d{2}[- ]\d{4}(?![0-9])/g, (_all, prefix: string) => prefix + mask)
  .replace(/(^|[^0-9])(?:[0-9][ -]?){12,18}[0-9](?![0-9])/g, (_all, prefix: string) => prefix + mask)
  .replace(/(^|[^0-9])(?:\+?1[ .-]?)?(?:\([0-9]{3}\)|[0-9]{3})[ .-]?[0-9]{3}[ .-]?[0-9]{4}(?![0-9])/g, (_all, prefix: string) => prefix + mask)
  .replace(/(^|[^0-9])\d{9}(?![0-9])/g, (_all, prefix: string) => prefix + mask)
 // Address and network identifiers are a reviewed pipeline transform.
 // Before approval they remain available to the existing exact subject erasure.
 if (!identifiers) return value
 return value
  .replace(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g, mask)
  .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, mask)
  .replace(/(?:[a-fA-F0-9]{0,4}:){2,7}[a-fA-F0-9]{0,4}(?:%[a-zA-Z0-9_.-]{1,32})?/g, mask)
}

/** Clone and mask every nested value and key without retaining raw inputs. */
export function sanitize<T>(input: T, rules: RedactionRule[] = [], identifiers = true): T {
 const custom = rules.map(rule => ({ regex:customPattern(rule.pattern), exceptions:rule.exceptions }))
 const seen = new WeakMap<object, unknown>()
 let nodes = 0
 function visit(value: unknown, depth: number): unknown {
  if (++nodes > 100000 || depth > 64) return mask
  if (typeof value === 'string') {
   // JSON log bodies stay parseable while sensitive object keys and nested
   // values receive the same masks as structured OTLP attributes.
   if (/^\s*[\[{]/.test(value) && value.length <= maxBytes) {
    try { const decoded = JSON.parse(value), masked = visit(decoded, depth + 1); return JSON.stringify(decoded) === JSON.stringify(masked) ? value : JSON.stringify(masked) } catch { /* malformed text is masked below */ }
   }
   return string(value, custom, identifiers)
  }
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100000000 && value <= 9999999999999999999) return string(String(value), custom, identifiers) === String(value) ? value : mask
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return seen.get(value)
  if (Array.isArray(value)) {
   const result: unknown[] = []; seen.set(value, result)
   for (const child of value) result.push(visit(child, depth + 1))
   return result
  }
  const result: Record<string, unknown> = Object.create(null); seen.set(value, result)
  for (const [key, child] of Object.entries(value)) {
   const clean = string(key, custom, identifiers)
   let unique = clean, collision = 1
   while (Object.hasOwn(result, unique)) unique = `${clean}_${collision++}`
   result[unique] = key === 'value' && typeof (value as Record<string,unknown>).key === 'string' && secretKey.test(String((value as Record<string,unknown>).key)) ? {stringValue:mask} : secretKey.test(key) ? mask : visit(child, depth + 1)
  }
  return result
 }
 return visit(input, 0) as T
}

/** Preserve only validated structural OTLP identities and native delivery clocks. */
export function sanitizePayload(input: Record<string, unknown>, rules: RedactionRule[] = [], identifiers = false): Record<string, unknown> {
 const result = sanitize(input, rules, identifiers)
 const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
 const source = object(input.record), target = object(result.record)
 if (source && target) {
  for (const [key, length] of [['traceId',32],['spanId',16],['parentSpanId',16]] as const) {
   const value = source[key]
   if (typeof value === 'string' && value.length === length && /^[a-fA-F0-9]+$/.test(value) && !/^0+$/.test(value)) target[key] = value
  }
  for (const key of ['timeUnixNano','observedTimeUnixNano','startTimeUnixNano','endTimeUnixNano']) {
   const value = source[key]
   if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n) target[key] = value
  }
  if (Array.isArray(source.events) && Array.isArray(target.events)) {
   for (let index=0;index<source.events.length;index++) {
    const event=object(source.events[index]),cleanEvent=object(target.events[index]),value=event?.timeUnixNano
    if (cleanEvent && typeof value === 'string' && /^[0-9]{1,20}$/.test(value) && BigInt(value) <= 18446744073709551615n) cleanEvent.timeUnixNano=value
   }
  }
  if (Array.isArray(source.links) && Array.isArray(target.links)) {
   for (let index=0;index<source.links.length;index++) {
    const link=object(source.links[index]),cleanLink=object(target.links[index])
    if (!link || !cleanLink) continue
    for (const [key,length] of [['traceId',32],['spanId',16]] as const) {
     const value=link[key]
     if (typeof value === 'string' && value.length === length && /^[a-fA-F0-9]+$/.test(value) && !/^0+$/.test(value)) cleanLink[key]=value
    }
   }
  }
 }
 const delivery = object(input.delivery), cleanDelivery = object(result.delivery)
 if (delivery && cleanDelivery) {
  for (const key of ['receivedTimeUnixNano','arrivalDeltaNs','clockAheadNs']) {
   const value = delivery[key]
   if (typeof value === 'string' && /^-?[0-9]{1,20}$/.test(value) && (key === 'arrivalDeltaNs' || !value.startsWith('-'))) cleanDelivery[key] = value
  }
 }
 return result
}
