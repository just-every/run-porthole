import { invalid } from '../ingest/model'
import { redactionRules, type RedactionRule } from './redact'

export type Scalar = string | number | boolean | null
type Parse = { source?: string; target?: string; overwrite?: boolean }
export type Processor =
 | ({ type: 'json'; } & Parse)
 | ({ type: 'kv'; } & Parse)
 | ({ type: 'grok'; pattern: string } & Parse)
 | { type: 'enrich'; values: Record<string, Scalar>; overwrite?: boolean }
 | { type: 'remap'; from: string; to: string; overwrite?: boolean; removeSource?: boolean }
 | { type: 'status'; source: string; target?: string; mapping?: Record<string, string> }
 | { type: 'category'; target: string; categories: { name: string; field: string; equals: string }[]; overwrite?: boolean }
 | { type: 'lookup'; source: string; target: string; version: string; table: Record<string, Scalar>; default?: Scalar; overwrite?: boolean }
 | { type: 'url' | 'user-agent'; source: string; target: string; overwrite?: boolean }
 | { type: 'arithmetic'; target: string; left: string | number; operator: '+' | '-' | '*' | '/'; right: string | number; overwrite?: boolean }
 | { type: 'route'; field: string; equals: string; destination: string }
export interface Definition {
 service: string; environment: string; team: string; processors: Processor[]
 metrics: { name: string; field?: string; equals?: string }[]
 exclude?: { field: string; equals: string }
 redaction?: RedactionRule[]
}
const bad = (): never => invalid('invalid_pipeline', 400)
function object(value: unknown): Record<string, unknown> {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return bad()
 return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
 if (Object.keys(value).some(key => !allowed.includes(key))) bad()
}
const text = (value: unknown, max = 1024): string => typeof value === 'string' && value.length > 0 && value.length <= max ? value : bad()
const scope = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value) ? value : bad()
export const field = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z_][a-zA-Z0-9_.-]{0,119}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value) ? value : bad()
function scalar(value: unknown): Scalar {
 if (value === null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value
 return text(value, 2048)
}
function flag(d: Record<string, unknown>, key: string): boolean | undefined {
 if (d[key] !== undefined && typeof d[key] !== 'boolean') bad()
 return d[key] as boolean | undefined
}
function dictionary(value: unknown): Record<string, Scalar> {
 const d = object(value), entries = Object.entries(d)
 if (entries.length > 100) bad()
 return Object.fromEntries(entries.map(([key, value]) => [text(key, 120), scalar(value)]))
}
export interface GrokPart { literal?: string; kind?: string; name?: string }
// Literal text and named built-ins only: there is no regular-expression execution.
export function grokParts(pattern: string): GrokPart[] {
 const parts: GrokPart[] = [], names = new Set<string>()
 let cursor = 0
 while (cursor < pattern.length) {
  const start = pattern.indexOf('%{', cursor)
  if (start < 0) { parts.push({ literal: pattern.slice(cursor) }); break }
  if (start > cursor) parts.push({ literal: pattern.slice(cursor, start) })
  const end = pattern.indexOf('}', start + 2)
  if (end < 0) return bad()
  const token = pattern.slice(start + 2, end).split(':')
  if (token.length !== 2 || !['word', 'integer', 'number', 'notSpace', 'data', 'greedyData'].includes(token[0])) return bad()
  const name = field(token[1])
  if (names.has(name) || names.size >= 16 || parts.at(-1)?.kind) return bad()
  names.add(name); parts.push({ kind: token[0], name }); cursor = end + 1
  if (token[0] === 'greedyData' && cursor < pattern.length) return bad()
 }
 if (!names.size) bad()
 return parts
}
function processor(value: unknown): Processor {
 const d = object(value), type = d.type
 const common = ['type', 'source', 'target', 'overwrite']
 const overwrite = flag(d, 'overwrite')
 if (type === 'json' || type === 'kv' || type === 'grok') {
  keys(d, [...common, ...(type === 'grok' ? ['pattern'] : [])])
  const parse = { source: d.source === undefined ? undefined : field(d.source), target: d.target === undefined ? undefined : field(d.target), overwrite }
  if (type !== 'grok') return { type, ...parse }
  const pattern = text(d.pattern, 512); grokParts(pattern)
  return { type, ...parse, pattern }
 }
 if (type === 'enrich') {
  keys(d, ['type', 'values', 'overwrite'])
  const values = dictionary(d.values); Object.keys(values).forEach(field)
  return { type, values, overwrite }
 }
 if (type === 'remap') {
  keys(d, ['type', 'from', 'to', 'overwrite', 'removeSource'])
  const from = field(d.from), to = field(d.to)
  if (from === to) bad()
  return { type, from, to, overwrite, removeSource: flag(d, 'removeSource') }
 }
 if (type === 'status') {
  keys(d, ['type', 'source', 'target', 'mapping'])
  const mapping = d.mapping === undefined ? undefined : dictionary(d.mapping)
  if (mapping && Object.values(mapping).some(v => typeof v !== 'string' || !['debug','info','notice','warning','error','critical','alert','emergency'].includes(v))) bad()
  return { type, source: field(d.source), target: d.target === undefined ? undefined : field(d.target), mapping: mapping as Record<string, string> | undefined }
 }
 if (type === 'category') {
  keys(d, ['type', 'target', 'categories', 'overwrite'])
  if (!Array.isArray(d.categories) || !d.categories.length || d.categories.length > 32) return bad()
  return { type, target: field(d.target), overwrite, categories: d.categories.map(raw => { const c = object(raw); keys(c, ['name','field','equals']); return { name: text(c.name, 120), field: field(c.field), equals: text(c.equals) } }) }
 }
 if (type === 'lookup') {
  keys(d, ['type','source','target','version','table','default','overwrite'])
  return { type, source: field(d.source), target: field(d.target), version: scope(d.version), table: dictionary(d.table), ...(d.default === undefined ? {} : { default: scalar(d.default) }), overwrite }
 }
 if (type === 'url' || type === 'user-agent') {
  keys(d, common); return { type, source: field(d.source), target: field(d.target), overwrite }
 }
 if (type === 'arithmetic') {
  keys(d, ['type','target','left','operator','right','overwrite'])
  if (!['+','-','*','/'].includes(String(d.operator))) return bad()
  const operand = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : field(v)
  return { type, target: field(d.target), left: operand(d.left), operator: d.operator as '+'|'-'|'*'|'/', right: operand(d.right), overwrite }
 }
 if (type === 'route') {
  keys(d, ['type','field','equals','destination'])
  return { type, field: field(d.field), equals: text(d.equals), destination: scope(d.destination) }
 }
 return bad()
}
export function definition(input: unknown): Definition {
 const d = object(input)
 keys(d, ['service','environment','team','processors','metrics','exclude','redaction'])
 if (!Array.isArray(d.processors) || d.processors.length > 32 || !Array.isArray(d.metrics) || d.metrics.length > 16) return bad()
 const metrics = d.metrics.map(raw => {
  const m = object(raw); keys(m, ['name','field','equals'])
  if ((m.field === undefined) !== (m.equals === undefined)) bad()
  return { name: scope(m.name), ...(m.field === undefined ? {} : { field: field(m.field), equals: text(m.equals) }) }
 })
 if (new Set(metrics.map(m => m.name)).size !== metrics.length) bad()
 let exclude: Definition['exclude']
 if (d.exclude !== undefined) { const e = object(d.exclude); keys(e, ['field','equals']); exclude = { field: field(e.field), equals: text(e.equals) } }
 return { service: scope(d.service), environment: scope(d.environment), team: scope(d.team), processors: d.processors.map(processor), metrics, ...(exclude ? { exclude } : {}), ...(d.redaction === undefined ? {} : { redaction:redactionRules(d.redaction) }) }
}
export const pipelineScope = (d: Definition) => ({ services: [d.service], environments: [d.environment], teams: [d.team] })
