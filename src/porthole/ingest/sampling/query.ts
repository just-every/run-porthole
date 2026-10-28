import type { Bindings } from '../../../auth.server'
import { fail, scopeWithin, type Authority } from '../../security/authority'
import { nano, object } from '../model'
import { policy, policyScope } from './model'

/** Counts accepted spans, rather than trace decisions, so distributed sibling
 * spans and promoted traces reconcile against the intake ledger exactly. */
export async function samplingQuery(env:Bindings,actor:Authority,data:Record<string,unknown>) {
 const d=policy({...object(data.scope),ordinaryPercent:10,slowThresholdMs:150}),from=nano(data.from),through=nano(data.through)
 if(from>=through)fail('invalid_query_range',400)
 if(!scopeWithin(policyScope(d),actor.member.scope))fail('scope_forbidden')
 const args=[d.team,d.service,d.environment,from,through]
 const summary=await env.DB.prepare(`SELECT COUNT(*) AS accepted,
  COALESCE(SUM(CASE WHEN b.state='pending' OR b.sampling_pending=1 THEN 1 ELSE 0 END),0) AS pending,
  COALESCE(SUM(CASE WHEN b.sampling_pending=0 AND d.retained=0 THEN 1 ELSE 0 END),0) AS intentionally_sampled,
  COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM porthole_telemetry_records r WHERE r.batch_id=b.id AND r.ordinal=CAST(j.key AS INTEGER)) THEN 1 ELSE 0 END),0) AS queryable,
  COALESCE(SUM(CASE WHEN EXISTS(SELECT 1 FROM porthole_telemetry_archive r WHERE r.batch_id=b.id AND r.ordinal=CAST(j.key AS INTEGER)) THEN 1 ELSE 0 END),0) AS archived,
  COALESCE(SUM(CASE WHEN d.reason='error' THEN 1 ELSE 0 END),0) AS error_trace_spans,
  COALESCE(SUM(CASE WHEN d.reason='slow' THEN 1 ELSE 0 END),0) AS slow_trace_spans,
  COALESCE(SUM(CASE WHEN d.promoted_at IS NOT NULL THEN 1 ELSE 0 END),0) AS promoted_trace_spans
  FROM porthole_ingest_batches b,json_each(b.records) j LEFT JOIN porthole_sampling_decisions d ON d.team=json_extract(j.value,'$.team') AND d.environment=json_extract(j.value,'$.environment') AND d.trace_id=json_extract(j.value,'$.traceId')
  WHERE b.signal='traces' AND json_extract(j.value,'$.payload.inputStage')='pre-sampling' AND json_extract(j.value,'$.team')=? AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.eventTimeNs')>=? AND json_extract(j.value,'$.eventTimeNs')<? AND ${actor.fence}`).bind(...args,...actor.args).first<Record<string,number>>()
 const losses=(await env.DB.prepare(`SELECT kind,reason,SUM(COALESCE(record_count,0)) AS records,COUNT(*) AS events,SUM(CASE WHEN record_count IS NULL THEN 1 ELSE 0 END) AS unknown_batches FROM porthole_ingest_events WHERE signal='traces' AND team=? AND service=? AND environment=? AND kind IN ('rejected','source_loss','buffer_loss') AND (range_start_ns IS NULL OR range_start_ns<? AND range_end_ns>=?) AND ${actor.fence} GROUP BY kind,reason`).bind(d.team,d.service,d.environment,through,from,...actor.args).all()).results
 const control=await env.DB.prepare('SELECT max_pending_bytes FROM porthole_ingest_control WHERE singleton=1').first<{max_pending_bytes:number}>()
 const acceptedComplete=!!summary?.accepted&&!summary.pending&&!losses.length&&summary.accepted===summary.queryable+summary.intentionally_sampled&&summary.queryable===summary.archived
 return {scope:policyScope(d),from,through,interval:'half-open',summary,losses,coverage:{status:acceptedComplete?'accepted-input-complete':'incomplete',upstream:'unknown',independentlyVerified:false},buffer:{maximumPendingBytes:control?.max_pending_bytes,overflow:'refuse-before-acknowledgement; retry-after; authenticated rejection receipt',custody:'existing durable intake envelopes',lateErrorRecovery:'all accepted siblings while original envelopes remain in custody'},physicalStorage:'Original envelopes remain stored; sampled retention does not reduce physical raw storage.'}
}
