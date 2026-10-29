import type { TelemetryRecord } from '../ingest/model'
import { grokParts, type Definition, type Processor } from './model'
import { sanitizePayload } from './redact'
import { evaluateArithmetic, parseArithmetic } from './arithmetic'

type Attributes = Record<string, unknown>
class ProcessorError extends Error {}
const error = (code: string): never => { throw new ProcessorError(code) }
const object = (v: unknown): Attributes | undefined => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Attributes : undefined
const owns = (v: Attributes, key: string) => Object.hasOwn(v, key)
const safeField = (key: string) => /^[a-zA-Z_][a-zA-Z0-9_.-]{0,119}$/.test(key) && !['__proto__','prototype','constructor'].includes(key)
function source(attrs: Attributes, body: unknown, key = 'body'): unknown { return key === 'body' ? body : attrs[key] }
function input(attrs: Attributes, body: unknown, key?: string): string {
 const value = source(attrs, body, key)
 if (typeof value !== 'string') return error('source_not_string')
 if (value.length > 65536) return error('source_too_large')
 return value
}
function write(attrs: Attributes, target: string, value: unknown, overwrite = false) {
 if (!safeField(target)) return error('invalid_attribute')
 if (owns(attrs, target) && !overwrite) return error('target_exists')
 if (!owns(attrs, target) && Object.keys(attrs).length >= 256) return error('attribute_limit')
 attrs[target] = value
}
function parsed(attrs: Attributes, values: Attributes, target?: string, overwrite = false) {
 const entries = Object.entries(values)
 if (entries.length > 128) return error('attribute_limit')
 for (const [key] of entries) {
  const dest = target ? `${target}.${key}` : key
  if (!safeField(dest)) return error('invalid_attribute')
  if (owns(attrs, dest) && !overwrite) return error('target_exists')
 }
 if (Object.keys(attrs).length + entries.filter(([key]) => !owns(attrs, target ? `${target}.${key}` : key)).length > 256) return error('attribute_limit')
 for (const [key, value] of entries) write(attrs, target ? `${target}.${key}` : key, value, overwrite)
}
function kv(value: string): Attributes {
 const result: Attributes = Object.create(null)
 let cursor = 0, count = 0
 while (cursor < value.length) {
  while (cursor < value.length && /\s/.test(value[cursor])) cursor++
  if (cursor === value.length) break
  const start = cursor
  while (cursor < value.length && /[a-zA-Z0-9_.-]/.test(value[cursor])) cursor++
  const key = value.slice(start, cursor)
  if (!safeField(key) || value[cursor++] !== '=' || ++count > 128 || owns(result, key)) return error('kv_parse_failed')
  let item = ''
  if (value[cursor] === '"' || value[cursor] === "'") {
   const quote = value[cursor++]; let closed = false
   while (cursor < value.length) {
    const char = value[cursor++]
    if (char === quote) { closed = true; break }
    if (char === '\\') { if (cursor === value.length) return error('kv_parse_failed'); item += value[cursor++] }
    else item += char
   }
   if (!closed || cursor < value.length && !/\s/.test(value[cursor])) return error('kv_parse_failed')
  } else {
   const begin = cursor
   while (cursor < value.length && !/\s/.test(value[cursor])) cursor++
   item = value.slice(begin, cursor)
  }
  result[key] = item
 }
 if (!count) return error('kv_parse_failed')
 return result
}
function grok(value: string, pattern: string): Attributes {
 const parts = grokParts(pattern), result: Attributes = Object.create(null)
 let cursor = 0
 for (let i = 0; i < parts.length; i++) {
  const part = parts[i]
  if (part.literal !== undefined) {
   if (!value.startsWith(part.literal, cursor)) return error('grok_no_match')
   cursor += part.literal.length; continue
  }
  const next = parts[i + 1]?.literal
  const end = next === undefined ? value.length : value.indexOf(next, cursor)
  if (end < cursor) return error('grok_no_match')
  const captured = value.slice(cursor, end)
  if (part.kind === 'word' && !/^[\p{L}\p{N}_]+$/u.test(captured) || part.kind === 'notSpace' && !/^\S+$/.test(captured) || part.kind === 'integer' && !/^[+-]?[0-9]+$/.test(captured) || part.kind === 'number' && !/^[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)$/.test(captured)) return error('grok_no_match')
  const numeric = part.kind === 'integer' || part.kind === 'number'
  if (numeric && (!Number.isFinite(Number(captured)) || part.kind === 'integer' && !Number.isSafeInteger(Number(captured)))) return error('grok_numeric_range')
  result[part.name!] = numeric ? Number(captured) : captured; cursor = end
 }
 if (cursor !== value.length) return error('grok_no_match')
 return result
}
function apply(p: Processor, attrs: Attributes, body: unknown) {
 if (p.type === 'json' || p.type === 'kv' || p.type === 'grok') {
  const text = input(attrs, body, p.source)
  let values: Attributes
  if (p.type === 'json') {
   let value: unknown
   try { value = JSON.parse(text) } catch { return error('json_parse_failed') }
   const record = object(value)
   if (!record) return error('json_object_required')
   values = record
  } else values = p.type === 'kv' ? kv(text) : grok(text, p.pattern)
  parsed(attrs, values, p.target, p.overwrite); return
 }
 if (p.type === 'enrich') { parsed(attrs, p.values, undefined, p.overwrite); return }
 if (p.type === 'remap') {
  if (!owns(attrs, p.from)) return error('source_missing')
  write(attrs, p.to, attrs[p.from], p.overwrite)
  if (p.removeSource) delete attrs[p.from]
  return
 }
 if (p.type === 'status') {
  const value = source(attrs, body, p.source)
  if (typeof value !== 'string' && typeof value !== 'number') return error('status_unmapped')
  const status = String(value).toLowerCase()
  const defaults: Record<string, string> = { trace:'debug',debug:'debug',info:'info',information:'info',notice:'notice',warn:'warning',warning:'warning',err:'error',error:'error',critical:'critical',fatal:'critical',alert:'alert',emergency:'emergency' }
  const mapping = p.mapping ?? defaults
  if (!owns(mapping, status)) return error('status_unmapped')
  write(attrs, p.target ?? 'status', mapping[status], true); return
 }
 if (p.type === 'category') {
  const category = p.categories.find(c => equal(source(attrs, body, c.field), c.equals))
  if (category) write(attrs, p.target, category.name, p.overwrite)
  return
 }
 if (p.type === 'lookup') {
  const value = source(attrs, body, p.source)
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return error('lookup_source_type')
  const key = String(value)
  if (owns(p.table, key)) write(attrs, p.target, p.table[key], p.overwrite)
  else if (owns(p, 'default')) write(attrs, p.target, p.default, p.overwrite)
  else error('lookup_miss')
  return
 }
 if (p.type === 'url') {
  let url: URL
  try { url = new URL(input(attrs, body, p.source)) } catch { return error('url_parse_failed') }
  if (!['http:', 'https:'].includes(url.protocol)) return error('url_scheme_unsupported')
  parsed(attrs, { scheme:url.protocol.slice(0,-1), host:url.hostname, port:url.port, path:url.pathname, query:url.search.slice(1), fragment:url.hash.slice(1) }, p.target, p.overwrite); return
 }
 if (p.type === 'user-agent') {
  const value = input(attrs, body, p.source)
  const match = /\b(Edg|OPR)\/([0-9]+(?:\.[0-9]+){0,3})/.exec(value) ?? /\b(Chrome|Firefox|Version)\/([0-9]+(?:\.[0-9]+){0,3})/.exec(value)
  const os = /Windows NT/.test(value) ? 'Windows' : /Android/.test(value) ? 'Android' : /iPhone|iPad/.test(value) ? 'iOS' : /Macintosh/.test(value) ? 'macOS' : /Linux/.test(value) ? 'Linux' : 'unknown'
  const browser = match ? ({ Edg:'Edge',OPR:'Opera',Version:'Safari' } as Record<string,string>)[match[1]] ?? match[1] : 'unknown'
  parsed(attrs, { browser, version:match?.[2] ?? null, os, device:/Mobile|iPhone|Android/.test(value) ? 'mobile' : 'unknown' }, p.target, p.overwrite); return
 }
 if (p.type === 'arithmetic') {
  if ('expression' in p) {
   write(attrs, p.target, evaluateArithmetic(parseArithmetic(p.expression), attrs, error), p.overwrite); return
  }
  const operand = (v: string | number) => { const value = typeof v === 'number' ? v : attrs[v]; if (typeof value !== 'number' || !Number.isFinite(value)) return error('arithmetic_operand_type'); return value }
  const left = operand(p.left), right = operand(p.right)
  if (p.operator === '/' && right === 0) return error('arithmetic_divide_by_zero')
  const result = p.operator === '+' ? left + right : p.operator === '-' ? left - right : p.operator === '*' ? left * right : left / right
  if (!Number.isFinite(result)) return error('arithmetic_numeric_range')
  write(attrs, p.target, result, p.overwrite); return
 }
 if (p.type === 'route' && equal(source(attrs, body, p.field), p.equals)) write(attrs, 'route.destination', p.destination, true)
}
function equal(value: unknown, expected: string): boolean { return ['string','number','boolean'].includes(typeof value) && String(value) === expected }
function initial(record: TelemetryRecord): Attributes {
 const attrs: Attributes = Object.create(null)
 for (const container of [object(record.payload.resource), object(record.payload.record)]) {
  if (!Array.isArray(container?.attributes)) continue
  for (const item of container.attributes.slice(0, 256)) {
   const attr = object(item), value = object(attr?.value)
   if (typeof attr?.key !== 'string' || !safeField(attr.key) || !value) continue
   attrs[attr.key] = value.stringValue ?? value.intValue ?? value.doubleValue ?? value.boolValue ?? null
  }
 }
 return attrs
}
export function transform(record: TelemetryRecord, d: Definition, revision: number): TelemetryRecord {
 const clean = { ...record, payload:sanitizePayload(record.payload, d.redaction, true) }, attrs = initial(clean), errors: {processor:number;code:string}[] = []
 const body = object(object(clean.payload.record)?.body)?.stringValue
 if (record.service !== d.service || record.environment !== d.environment || record.team !== d.team) return clean
 for (const [index, processor] of d.processors.entries()) {
  try { apply(processor, attrs, body) } catch (cause) { errors.push({ processor:index, code:cause instanceof ProcessorError ? cause.message : 'processor_failed' }) }
 }
 const original = object(record.payload.record)
 const protectedRecord = errors.length > 0 || typeof original?.severityNumber === 'number' && original.severityNumber >= 17 || /^(?:error|fatal|critical)$/i.test(String(original?.severityText ?? '')) || ['error','critical','alert','emergency'].includes(String(attrs.status ?? '').toLowerCase())
 const excluded = !protectedRecord && !!d.exclude && equal(source(attrs, body, d.exclude.field), d.exclude.equals)
 clean.payload.pipeline = { revision, status:errors.length ? 'error' : 'ok', errors, excluded, protected:protectedRecord, attributes:attrs }
 return { ...clean, payload:sanitizePayload(clean.payload, d.redaction, true) }
}
export function metricMatches(record: TelemetryRecord, d: Definition): string[] {
 if (record.service !== d.service || record.environment !== d.environment || record.team !== d.team) return []
 const attrs = object(object(record.payload.pipeline)?.attributes) ?? initial(record)
 const body = object(object(record.payload.record)?.body)?.stringValue
 return d.metrics.filter(m => m.field === undefined || equal(source(attrs, body, m.field), m.equals!)).map(m => m.name)
}
