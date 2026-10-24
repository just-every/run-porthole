import { fail } from '../../security/authority'

/** One independent OTLP JSON ExportRequest per retained OTLP record. Keeping
 * profile dictionaries separate preserves their local reference indices. */
export function otlpExport(signal: string, payload: Record<string, unknown>): Record<string, unknown> {
 if (payload.protocol) fail('source_format_requires_ndjson', 409)
 const capital = signal === 'traces' ? 'Spans' : signal === 'logs' ? 'Logs' : signal === 'metrics' ? 'Metrics' : 'Profiles'
 const item = signal === 'metrics' ? (() => {
  const kind = String(payload.metricKind), metric = payload.metric as Record<string, unknown>
  if (!metric || !['gauge','sum','histogram','exponentialHistogram','summary'].includes(kind)) fail('source_format_requires_ndjson', 409)
  return { ...metric, [kind]: { ...(metric[kind] as object), dataPoints: [payload.record] } }
 })() : payload.record
 return {
  ...(signal === 'profiles' ? { dictionary: payload.dictionary } : {}),
  [`resource${capital}`]: [{ resource: payload.resource, schemaUrl: payload.resourceSchemaUrl,
   [`scope${capital}`]: [{ scope: payload.scope, schemaUrl: payload.scopeSchemaUrl,
    [signal === 'traces' ? 'spans' : signal === 'logs' ? 'logRecords' : signal === 'metrics' ? 'metrics' : 'profiles']: [item] }] }],
 }
}
