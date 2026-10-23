// OTLP schema: opentelemetry-proto v1.9.0 (profiles v1development). Schemas are local descriptors for
// the official wire messages, not an application-specific telemetry format.
import { base64, invalid } from './model'
import { bytes, double, fields, fixed, hex, Proto, uint, utf8, type Field } from './wire'
type Descriptor = Record<number, [string, string, boolean?]>
const common: Record<string, Descriptor> = {
 AnyValue: { 1: ['stringValue','string'], 2: ['boolValue','bool'], 3: ['intValue','int64'], 4: ['doubleValue','double'], 5: ['arrayValue','ArrayValue'], 6: ['kvlistValue','KeyValueList'], 7: ['bytesValue','bytes'] },
 ArrayValue: { 1: ['values','AnyValue',true] }, KeyValueList: { 1: ['values','KeyValue',true] },
 KeyValue: { 1: ['key','string'], 2: ['value','AnyValue'] },
 Resource: { 1: ['attributes','KeyValue',true], 2: ['droppedAttributesCount','uint'] },
 Scope: { 1: ['name','string'], 2: ['version','string'], 3: ['attributes','KeyValue',true], 4: ['droppedAttributesCount','uint'] },
 Profiles: { 1: ['resourceProfiles','ResourceProfiles',true], 2: ['dictionary','ProfilesDictionary'] },
 ResourceProfiles: { 1: ['resource','Resource'], 2: ['scopeProfiles','ScopeProfiles',true], 3: ['schemaUrl','string'] },
 ScopeProfiles: { 1: ['scope','Scope'], 2: ['profiles','Profile',true], 3: ['schemaUrl','string'] },
 ProfilesDictionary: { 1: ['mappingTable','ProfileMapping',true], 2: ['locationTable','ProfileLocation',true], 3: ['functionTable','ProfileFunction',true], 4: ['linkTable','ProfileLink',true], 5: ['stringTable','string',true], 6: ['attributeTable','ProfileAttribute',true], 7: ['stackTable','ProfileStack',true] },
 Profile: { 1: ['sampleType','ProfileValueType'], 2: ['samples','ProfileSample',true], 3: ['timeUnixNano','fixed64'], 4: ['durationNano','uint64'], 5: ['periodType','ProfileValueType'], 6: ['period','int64'], 7: ['profileId','hex'], 8: ['droppedAttributesCount','uint'], 9: ['originalPayloadFormat','string'], 10: ['originalPayload','bytes'], 11: ['attributeIndices','int32',true] },
 ProfileValueType: { 1: ['typeStrindex','int32'], 2: ['unitStrindex','int32'] },
 ProfileSample: { 1: ['stackIndex','int32'], 2: ['values','int64',true], 3: ['attributeIndices','int32',true], 4: ['linkIndex','int32'], 5: ['timestampsUnixNano','fixed64',true] },
 ProfileMapping: { 1: ['memoryStart','uint64'], 2: ['memoryLimit','uint64'], 3: ['fileOffset','uint64'], 4: ['filenameStrindex','int32'], 5: ['attributeIndices','int32',true] },
 ProfileLocation: { 1: ['mappingIndex','int32'], 2: ['address','uint64'], 3: ['lines','ProfileLine',true], 4: ['attributeIndices','int32',true] },
 ProfileLine: { 1: ['functionIndex','int32'], 2: ['line','int64'], 3: ['column','int64'] },
 ProfileFunction: { 1: ['nameStrindex','int32'], 2: ['systemNameStrindex','int32'], 3: ['filenameStrindex','int32'], 4: ['startLine','int64'] },
 ProfileLink: { 1: ['traceId','hex'], 2: ['spanId','hex'] },
 ProfileAttribute: { 1: ['keyStrindex','int32'], 2: ['value','AnyValue'], 3: ['unitStrindex','int32'] },
 ProfileStack: { 1: ['locationIndices','int32',true] },
 Traces: { 1: ['resourceSpans','ResourceSpans',true] }, Logs: { 1: ['resourceLogs','ResourceLogs',true] }, Metrics: { 1: ['resourceMetrics','ResourceMetrics',true] },
 ResourceSpans: { 1: ['resource','Resource'], 2: ['scopeSpans','ScopeSpans',true], 3: ['schemaUrl','string'] },
 ResourceLogs: { 1: ['resource','Resource'], 2: ['scopeLogs','ScopeLogs',true], 3: ['schemaUrl','string'] },
 ResourceMetrics: { 1: ['resource','Resource'], 2: ['scopeMetrics','ScopeMetrics',true], 3: ['schemaUrl','string'] },
 ScopeSpans: { 1: ['scope','Scope'], 2: ['spans','Span',true], 3: ['schemaUrl','string'] },
 ScopeLogs: { 1: ['scope','Scope'], 2: ['logRecords','LogRecord',true], 3: ['schemaUrl','string'] },
 ScopeMetrics: { 1: ['scope','Scope'], 2: ['metrics','Metric',true], 3: ['schemaUrl','string'] },
 Span: { 1: ['traceId','hex'], 2: ['spanId','hex'], 3: ['traceState','string'], 4: ['parentSpanId','hex'], 5: ['name','string'], 6: ['kind','uint'], 7: ['startTimeUnixNano','fixed64'], 8: ['endTimeUnixNano','fixed64'], 9: ['attributes','KeyValue',true], 10: ['droppedAttributesCount','uint'], 11: ['events','Event',true], 12: ['droppedEventsCount','uint'], 13: ['links','Link',true], 14: ['droppedLinksCount','uint'], 15: ['status','Status'], 16: ['flags','fixed32'] },
 Event: { 1: ['timeUnixNano','fixed64'], 2: ['name','string'], 3: ['attributes','KeyValue',true], 4: ['droppedAttributesCount','uint'] },
 Link: { 1: ['traceId','hex'], 2: ['spanId','hex'], 3: ['traceState','string'], 4: ['attributes','KeyValue',true], 5: ['droppedAttributesCount','uint'], 6: ['flags','fixed32'] },
 Status: { 2: ['message','string'], 3: ['code','uint'] },
 LogRecord: { 1: ['timeUnixNano','fixed64'], 2: ['severityNumber','uint'], 3: ['severityText','string'], 5: ['body','AnyValue'], 6: ['attributes','KeyValue',true], 7: ['droppedAttributesCount','uint'], 8: ['flags','fixed32'], 9: ['traceId','hex'], 10: ['spanId','hex'], 11: ['observedTimeUnixNano','fixed64'], 12: ['eventName','string'] },
 Metric: { 1: ['name','string'], 2: ['description','string'], 3: ['unit','string'], 5: ['gauge','Gauge'], 7: ['sum','Sum'], 9: ['histogram','Histogram'], 10: ['exponentialHistogram','ExponentialHistogram'], 11: ['summary','Summary'], 12: ['metadata','KeyValue',true] },
 Gauge: { 1: ['dataPoints','NumberPoint',true] }, Sum: { 1: ['dataPoints','NumberPoint',true], 2: ['aggregationTemporality','uint'], 3: ['isMonotonic','bool'] },
 Histogram: { 1: ['dataPoints','HistogramPoint',true], 2: ['aggregationTemporality','uint'] }, ExponentialHistogram: { 1: ['dataPoints','ExponentialPoint',true], 2: ['aggregationTemporality','uint'] }, Summary: { 1: ['dataPoints','SummaryPoint',true] },
 NumberPoint: { 2: ['startTimeUnixNano','fixed64'], 3: ['timeUnixNano','fixed64'], 4: ['asDouble','double'], 5: ['exemplars','Exemplar',true], 6: ['asInt','sfixed64'], 7: ['attributes','KeyValue',true], 8: ['flags','uint'] },
 HistogramPoint: { 2: ['startTimeUnixNano','fixed64'], 3: ['timeUnixNano','fixed64'], 4: ['count','fixed64'], 5: ['sum','double'], 6: ['bucketCounts','fixed64',true], 7: ['explicitBounds','double',true], 8: ['exemplars','Exemplar',true], 9: ['attributes','KeyValue',true], 10: ['flags','uint'], 11: ['min','double'], 12: ['max','double'] },
 ExponentialPoint: { 1: ['attributes','KeyValue',true], 2: ['startTimeUnixNano','fixed64'], 3: ['timeUnixNano','fixed64'], 4: ['count','fixed64'], 5: ['sum','double'], 6: ['scale','sint'], 7: ['zeroCount','fixed64'], 8: ['positive','Buckets'], 9: ['negative','Buckets'], 10: ['flags','uint'], 11: ['exemplars','Exemplar',true], 12: ['min','double'], 13: ['max','double'], 14: ['zeroThreshold','double'] },
 Buckets: { 1: ['offset','sint'], 2: ['bucketCounts','uint64',true] },
 SummaryPoint: { 2: ['startTimeUnixNano','fixed64'], 3: ['timeUnixNano','fixed64'], 4: ['count','fixed64'], 5: ['sum','double'], 6: ['quantileValues','Quantile',true], 7: ['attributes','KeyValue',true], 8: ['flags','uint'] },
 Quantile: { 1: ['quantile','double'], 2: ['value','double'] },
 Exemplar: { 2: ['timeUnixNano','fixed64'], 3: ['asDouble','double'], 4: ['spanId','hex'], 5: ['traceId','hex'], 6: ['asInt','sfixed64'], 7: ['filteredAttributes','KeyValue',true] },
}
const numericWire: Record<string, number> = { uint: 0, int32: 0, uint64: 0, int64: 0, sint: 0, bool: 0, fixed64: 1, sfixed64: 1, double: 1, fixed32: 5 }
function scalar(field: Field, type: string, depth: number): unknown {
 if (numericWire[type] !== undefined && field.wire !== numericWire[type] || numericWire[type] === undefined && field.wire !== 2) return invalid('invalid_protobuf_field_type')
 if (common[type]) return decode(bytes(field), type, depth + 1)
 switch (type) {
  case 'string': return utf8(bytes(field))
  case 'hex': return hex(bytes(field))
  case 'bytes': return base64(bytes(field))
  case 'bool': return uint(field) !== 0n
  case 'uint': return Number(uint(field))
  case 'uint64': return uint(field).toString()
  case 'int32': return Number(BigInt.asIntN(32, uint(field)))
  case 'int64': return BigInt.asIntN(64, uint(field)).toString()
  case 'sint': { const n = uint(field); return Number((n >> 1n) ^ -(n & 1n)) }
  case 'fixed64': return fixed(field).toString()
  case 'sfixed64': return BigInt.asIntN(64, fixed(field)).toString()
  case 'fixed32': { const b = bytes(field); return new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(0, true) }
  case 'double': { const n = double(field); return Number.isFinite(n) ? n : String(n) }
  default: return invalid('unsupported_otlp_message', 415)
 }
}
export function decode(input: Uint8Array, type: string, depth = 0): Record<string, unknown> {
 if (depth > 24) return invalid('protobuf_nesting_too_deep')
 const result: Record<string, unknown> = {}, schema = common[type]
 for (const field of fields(input)) {
  const descriptor = schema[field.number]
  if (!descriptor) continue // Exact unknown bytes remain in wire_base64.
  const [name, kind, repeated] = descriptor
  let values: unknown[]
  if (repeated && field.wire === 2 && numericWire[kind] !== undefined) {
   const reader = new Proto(bytes(field)); values = []
   while (reader.position < reader.bytes.length) values.push(scalar({ number: field.number, wire: numericWire[kind], value: numericWire[kind] === 0 ? reader.varint() : reader.take(numericWire[kind] === 1 ? 8 : 4) }, kind, depth))
  } else values = [scalar(field, kind, depth)]
  if (repeated) result[name] = [...(result[name] as unknown[] ?? []), ...values]
  else { if (Object.hasOwn(result, name)) return invalid('duplicate_protobuf_field'); result[name] = values[0] }
 }
 return result
}
