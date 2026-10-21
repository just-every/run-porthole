import { array, invalid, object, type TelemetryRecord } from './model'
import { record } from './normalize'
import { bytes, double, fields, uint, utf8 } from './wire'

// prometheus.WriteRequest v1. Native histograms/exemplars require explicit
// support rather than quietly discarding fields from an acknowledged series.
export function remoteWrite(input: Uint8Array, headers: Headers): TelemetryRecord[] {
 const result: TelemetryRecord[] = []
 for (const field of fields(input)) {
  if (field.number === 3) continue // MetricMetadata, preserved in original wire.
  if (field.number !== 1) return invalid('unsupported_remote_write_field',415)
  const labels: Record<string,string> = Object.create(null), samples = []
  for (const part of fields(bytes(field))) {
   if (part.number === 1) {
    const pair = fields(bytes(part)), name = pair.find(p => p.number === 1), value = pair.find(p => p.number === 2)
    if (!name || !value) return invalid('invalid_remote_write_label')
    const key = utf8(bytes(name)); if (Object.hasOwn(labels,key)) return invalid('duplicate_remote_write_label')
    labels[key] = utf8(bytes(value))
   } else if (part.number === 2) samples.push(bytes(part))
   else return invalid('unsupported_remote_write_histogram_or_exemplar',415)
  }
  if (!labels.__name__) return invalid('missing_metric_name')
  for (const sample of samples) {
   const parts = fields(sample), valueField = parts.find(p => p.number === 1), time = parts.find(p => p.number === 2)
   const value = valueField ? double(valueField) : 0, timestamp = time ? BigInt.asIntN(64,uint(time)) : 0n
   if (timestamp < 0n) return invalid('negative_metric_timestamp')
   // NaN includes Prometheus' stale marker; the original float bits are retained.
   result.push(record({ protocol: 'prometheus.WriteRequest', resource: { attributes: labels }, metric: { name: labels.__name__ }, record: { value: Number.isFinite(value) ? value : String(value), timestamp: timestamp.toString() } }, labels, (timestamp * 1000000n).toString(), headers, 'metrics'))
  }
 }
 return result
}
function labels(text: string): Record<string,string> {
 if (!text.startsWith('{') || !text.endsWith('}')) return invalid('invalid_loki_labels')
 const result: Record<string,string> = Object.create(null); let tail = text.slice(1,-1).trim()
 while (tail) {
  const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*")\s*(?:,\s*|$)/.exec(tail)
  if (!match || Object.hasOwn(result,match[1])) return invalid('invalid_loki_labels')
  try { result[match[1]] = JSON.parse(match[2]) as string } catch { return invalid('invalid_loki_label_escape') }
  tail = tail.slice(match[0].length)
 }
 return result
}
export function lokiProto(input: Uint8Array): Record<string,unknown> {
 const streams = []
 for (const field of fields(input)) {
  if (field.number !== 1) return invalid('invalid_loki_push_request')
  const stream = fields(bytes(field)), labelField = stream.find(p => p.number === 1)
  if (!labelField) return invalid('missing_loki_labels')
  const values = []
  for (const entry of stream.filter(p => p.number === 2)) {
   const parts = fields(bytes(entry)), timeField = parts.find(p => p.number === 1), lineField = parts.find(p => p.number === 2)
   if (!timeField) return invalid('missing_loki_timestamp')
   const time = fields(bytes(timeField)), seconds = time.find(p => p.number === 1), nanos = time.find(p => p.number === 2)
   const ns = seconds ? BigInt.asIntN(64,uint(seconds)) * 1000000000n : 0n, fraction = nanos ? uint(nanos) : 0n
   if (fraction > 999999999n) return invalid('invalid_loki_timestamp')
   const metadata: Record<string,string> = Object.create(null)
   for (const part of parts.filter(p => p.number === 3)) {
    const pair = fields(bytes(part)), key = pair.find(p => p.number === 1), value = pair.find(p => p.number === 2)
    if (!key || !value) return invalid('invalid_loki_metadata')
    metadata[utf8(bytes(key))] = utf8(bytes(value))
   }
   if (parts.some(p => p.number === 4)) return invalid('unsupported_loki_parsed_fields',415)
   values.push([(ns + fraction).toString(), lineField ? utf8(bytes(lineField)) : '', metadata])
  }
  streams.push({ stream: labels(utf8(bytes(labelField))), values })
 }
 return { streams }
}
export function lokiRecords(data: Record<string, unknown>, headers: Headers): TelemetryRecord[] {
 const result: TelemetryRecord[] = [], now = BigInt(Date.now()) * 1000000n
 for (const item of array(data.streams)) {
  const stream = object(item), attr = object(stream.stream)
  if (Object.entries(attr).length > 30 || Object.entries(attr).some(([key,value]) => !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) || typeof value !== 'string' || key.length + value.length > 4096)) return invalid('invalid_loki_labels')
  for (const item of array(stream.values)) {
   const values = array(item)
   if (values.length < 2 || values.length > 3 || typeof values[0] !== 'string' || typeof values[1] !== 'string') return invalid('invalid_loki_entry')
   const metadata = values[2] === undefined ? {} : object(values[2])
   if (Object.values(metadata).some(value => typeof value !== 'string')) return invalid('invalid_loki_metadata')
   const entry = record({ protocol: 'loki.PushRequest', resource: { attributes: attr }, record: { timeUnixNano: values[0], body: { stringValue: values[1] }, structuredMetadata: metadata } }, attr, values[0], headers, 'logs')
   // Reject the whole batch with exact decoded count in HTTP accounting. No
   // partial success is emitted for a batch that an unchanged shipper retries.
   if (BigInt(entry.eventTimeNs) < now - 7200n * 1000000000n) entry.payload.rejection = 'loki_timestamp_older_than_two_hours'
   if (BigInt(entry.eventTimeNs) > now + 600n * 1000000000n) entry.payload.rejection = 'loki_timestamp_too_far_in_future'
   result.push(entry)
  }
 }
 return result
}
