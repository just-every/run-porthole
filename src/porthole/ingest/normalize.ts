import type { CredentialScope } from '../credentials/policy'
import { array, invalid, nano, object, type Signal, type TelemetryRecord } from './model'

export function attributes(value: unknown): Record<string, unknown> {
 const output: Record<string, unknown> = Object.create(null)
 for (const item of value === undefined ? [] : array(value)) {
  const entry = object(item)
  if (typeof entry.key !== 'string' || Object.hasOwn(output, entry.key)) return invalid('invalid_attributes')
  const v = object(entry.value)
  output[entry.key] = v.stringValue ?? v.intValue ?? v.doubleValue ?? v.boolValue ?? v
 }
 return output
}
function id(value: unknown, length: number, required = false): string | null {
 if (value === undefined || value === '') return required ? invalid('missing_trace_or_span_id') : null
 if (typeof value !== 'string' || !new RegExp(`^[0-9a-fA-F]{${length}}$`).test(value) || /^0+$/.test(value)) return invalid('invalid_trace_or_span_id')
 return value.toLowerCase()
}
export function record(payload: Record<string, unknown>, attr: Record<string, unknown>, timestamp: unknown, headers: Headers, signal: Signal): TelemetryRecord {
 const eventTimeNs = nano(timestamp), now = BigInt(Date.now()) * 1000000n
 const pick = (keys: string[], header: string) => {
  const value = keys.map(key => attr[key]).find(v => v !== undefined) ?? headers.get(header) ?? ''
  if (typeof value !== 'string' || value && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(value)) return invalid('invalid_resource_scope')
  return value
 }
 const body = object(payload.record)
 payload.delivery={receivedTimeUnixNano:now.toString(),arrivalDeltaNs:(now-BigInt(eventTimeNs)).toString(),clockAheadNs:(BigInt(eventTimeNs)>now?BigInt(eventTimeNs)-now:0n).toString(),uncertainTime:BigInt(eventTimeNs)===0n||BigInt(eventTimeNs)>now+600n*1000000000n}
 return { team: pick(['team.name','team_name','team'], 'x-porthole-team'), service: pick(['service.name','service_name','service','job'], 'x-porthole-service'), environment: pick(['deployment.environment.name','deployment.environment','deployment_environment_name','deployment_environment','environment','env'], 'x-porthole-environment'),
  eventTimeNs, traceId: id(body.traceId,32,signal === 'traces'), spanId: id(body.spanId,16,signal === 'traces'), payload,
  late: BigInt(eventTimeNs) < now - 10n * 60n * 1000000000n ? 1 : 0, outOfOrder: 0 }
}
export function otlpRecords(data: Record<string, unknown>, signal: Signal, headers: Headers): TelemetryRecord[] {
 const capital = signal === 'traces' ? 'Spans' : signal === 'logs' ? 'Logs' : 'Metrics'
 const resources = data[`resource${capital}`]
 if (resources === undefined) {
  if (Object.keys(data).length === 0) return [] // Official empty ExportRequest.
  return invalid('invalid_otlp_export_request')
 }
 const result: TelemetryRecord[] = []
 for (const item of array(resources)) {
  const group = object(item), resource = group.resource === undefined ? {} : object(group.resource), attr = attributes(resource.attributes)
  for (const scopeItem of group[`scope${capital}`] === undefined ? [] : array(group[`scope${capital}`])) {
   const scope = object(scopeItem), list = scope[signal === 'logs' ? 'logRecords' : signal === 'traces' ? 'spans' : 'metrics']
   for (const raw of list === undefined ? [] : array(list)) {
    const entry = object(raw), common = { resource, scope: scope.scope ?? {}, resourceSchemaUrl: group.schemaUrl ?? '', scopeSchemaUrl: scope.schemaUrl ?? '' }
    if (signal === 'metrics') {
     if (typeof entry.name !== 'string' || !entry.name) return invalid('missing_metric_name')
     const kinds = ['gauge','sum','histogram','exponentialHistogram','summary'].filter(key => entry[key] !== undefined)
     if (kinds.length !== 1) return invalid('invalid_metric_data')
     const kind = kinds[0], container = object(entry[kind]), points = container.dataPoints === undefined ? [] : array(container.dataPoints)
     for (const rawPoint of points) {
      const point = object(rawPoint), pointAttr = attributes(point.attributes)
      if (kind === 'gauge' || kind === 'sum') {
       if (Number(Object.hasOwn(point,'asDouble')) + Number(Object.hasOwn(point,'asInt')) !== 1) return invalid('missing_metric_value')
      }
      result.push(record({ ...common, metric: { ...entry, [kind]: { ...container, dataPoints: undefined } }, metricKind: kind, record: point }, { ...attr, ...pointAttr }, point.timeUnixNano ?? '0', headers, signal))
     }
    } else {
     if (signal === 'traces') {
      id(entry.parentSpanId,16)
      if (BigInt(nano(entry.endTimeUnixNano ?? '0')) < BigInt(nano(entry.startTimeUnixNano ?? '0'))) return invalid('span_end_before_start')
     }
     result.push(record({ ...common, record: entry }, attr, signal === 'traces' ? entry.startTimeUnixNano ?? '0' : entry.timeUnixNano ?? entry.observedTimeUnixNano ?? '0', headers, signal))
    }
   }
  }
 }
 if (result.length > 5000) return invalid('too_many_records', 413)
 return result
}
export function authorizeRecords(records: TelemetryRecord[], scope: CredentialScope, signal: string) {
 if (!scope.actions.includes('telemetry.write') || !scope.signals.includes(signal)) return invalid('credential_scope_forbidden',403)
 for (const record of records) {
  for (const [key, list] of [['service',scope.services],['environment',scope.environments],['team',scope.teams]] as const) {
   // Missing source attributes can only inherit one explicit credential grant.
   if (!record[key] && list.length === 1 && list[0] !== '*') record[key] = list[0]
   if (!record[key] || !list.includes('*') && !list.includes(record[key])) return invalid('credential_scope_forbidden',403)
  }
 }
}
