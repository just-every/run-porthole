import type { Bindings } from '../../auth.server'
import { operationDocument as document, escape, privateHeaders } from '../document'
import { authority, fail, scopeWithin, type Authority, type Scope } from '../security/authority'
import { input } from '../security/input'
import { nano } from './model'
import { scopeWhere } from './read'

export async function ingestStatus(env: Bindings, actor: Authority) {
 const scoped=scopeWhere(actor.member.scope), eventScope=scopeWhere(actor.member.scope,'e')
 const result=await env.DB.batch([
  env.DB.prepare('SELECT paused,max_pending_bytes,revision,changed_at FROM porthole_ingest_control WHERE singleton=1'),
  env.DB.prepare(`WITH records AS (SELECT b.source_id,b.signal,b.accepted_at,b.state,json_extract(j.value,'$.team') AS team,json_extract(j.value,'$.service') AS service,json_extract(j.value,'$.environment') AS environment FROM porthole_ingest_batches b,json_each(b.records) j)
   SELECT r.source_id,r.signal,r.team,r.service,r.environment,COUNT(*) AS accepted,SUM(CASE WHEN r.state='pending' THEN 1 ELSE 0 END) AS pending,MIN(CASE WHEN r.state='pending' THEN r.accepted_at ELSE NULL END) AS oldest_pending_at FROM records r WHERE ${scoped.sql} GROUP BY r.source_id,r.signal,r.team,r.service,r.environment`).bind(...scoped.args),
  env.DB.prepare(`SELECT r.source_id,r.signal,r.team,r.service,r.environment,COUNT(*) AS queryable,SUM(r.late) AS late,SUM(r.out_of_order) AS out_of_order,SUM(CASE WHEN json_extract(r.payload,'$.delivery.uncertainTime') THEN 1 ELSE 0 END) AS uncertain_time,SUM(CASE WHEN json_extract(r.payload,'$.delivery.clockAheadNs')!='0' THEN 1 ELSE 0 END) AS clock_ahead_records,MAX(r.indexed_at) AS last_queryable_at FROM porthole_telemetry_records r WHERE ${scoped.sql} GROUP BY r.source_id,r.signal,r.team,r.service,r.environment`).bind(...scoped.args),
  env.DB.prepare(`SELECT r.source_id,r.signal,r.team,r.service,r.environment,COUNT(*) AS archived FROM porthole_telemetry_archive r WHERE ${scoped.sql} GROUP BY r.source_id,r.signal,r.team,r.service,r.environment`).bind(...scoped.args),
  env.DB.prepare(`SELECT e.source_id,e.signal,e.team,e.service,e.environment,e.kind,e.reason,SUM(COALESCE(e.record_count,0)) AS count,SUM(CASE WHEN e.record_count IS NULL THEN 1 ELSE 0 END) AS unknown_batches,COUNT(*) AS events,MIN(e.occurred_at) AS first_at,MAX(e.occurred_at) AS last_at FROM porthole_ingest_events e WHERE ${eventScope.sql} GROUP BY e.source_id,e.signal,e.team,e.service,e.environment,e.kind,e.reason`).bind(...eventScope.args),
 ])
 const keyed=new Map<string,Record<string,unknown>>()
 const rowKey=(row:Record<string,unknown>)=>JSON.stringify([row.source_id,row.signal,row.team,row.service,row.environment])
 const ensure=(row:Record<string,unknown>)=>{
  const key=rowKey(row)
  if(!keyed.has(key))keyed.set(key,{sourceId:row.source_id,signal:row.signal,team:row.team,service:row.service,environment:row.environment,accepted:0,pending:0,queryable:0,archived:0,intentionallySampled:0,rejected:0,duplicates:0,lost:0,unknownRejectedBatches:0,late:0,outOfOrder:0,uncertainTime:0,clockAheadRecords:0,reasons:[],evaluation:'Unknown',complete:false,queueAgeMs:0})
  return keyed.get(key)!
 }
 for(const row of result[1].results as Record<string,unknown>[]){const target=ensure(row);Object.assign(target,{accepted:row.accepted,pending:row.pending,queueAgeMs:row.oldest_pending_at?Math.max(0,Date.now()-Number(row.oldest_pending_at)):0})}
 for(const row of result[2].results as Record<string,unknown>[]){const target=ensure(row);Object.assign(target,{queryable:row.queryable,late:row.late,outOfOrder:row.out_of_order,uncertainTime:row.uncertain_time,clockAheadRecords:row.clock_ahead_records,lastQueryableAt:row.last_queryable_at})}
 for(const row of result[3].results as Record<string,unknown>[])ensure(row).archived=row.archived
 for(const row of result[4].results as Record<string,unknown>[]){
  const target=ensure(row),key=row.kind==='rejected'?'rejected':row.kind==='duplicate'?'duplicates':'lost'
  target[key]=Number(target[key])+Number(row.count)
  if(row.kind!=='duplicate')target.unknownRejectedBatches=Number(target.unknownRejectedBatches)+Number(row.unknown_batches)
  ;(target.reasons as unknown[]).push({kind:row.kind,reason:row.reason,count:row.count,unknownBatches:row.unknown_batches,events:row.events,firstAt:row.first_at,lastAt:row.last_at})
 }
 for(const row of keyed.values()){
  // This is durable delivery coverage, not a monitor/SLO result. Unknown source
  // history cannot be made healthy by a later successful export.
  row.complete=Number(row.accepted)>0 && Number(row.pending)===0 && Number(row.rejected)===0 && Number(row.lost)===0 && Number(row.unknownRejectedBatches)===0 && Number(row.uncertainTime)===0 && row.accepted===row.queryable && row.queryable===row.archived
  row.evaluation=row.complete?'Complete':'Unknown'
 }
 return {control:result[0].results[0],sources:[...keyed.values()],sampling:'disabled',archive:'durable D1 copy; no external object store',protocols:{otlp:'HTTP JSON/protobuf traces, metrics, logs; profiles v1development (opentelemetry-proto v1.9.0)',grpc:'Separate owner-run scripts/porthole/otlp-grpc.mjs receiver; same scoped HTTP intake',remoteWrite:'Snappy protobuf prometheus.WriteRequest v1 float samples',loki:'JSON, gzip JSON and raw Snappy protobuf PushRequest (Loki v3.5.0)',unsupported:['OTLP gRPC on the Cloudflare HTTP listener','remote-write v2, native histograms and exemplars','Pyroscope']}}
}
export async function statusPage(request: Request,env: Bindings) {
 const actor=await authority(request,env,{manage:true}),status=await ingestStatus(env,actor)
 if(request.headers.get('accept')?.includes('application/json'))return Response.json(status,{headers:privateHeaders})
 const control=status.control as {paused:number;max_pending_bytes:number}
 const items=status.sources.map(row=>`<li><h2>${escape(String(row.service))} · ${escape(String(row.signal))}</h2><p>Source ${escape(String(row.sourceId))} · Team ${escape(String(row.team))} · ${escape(String(row.environment))}</p><dl>${['accepted','pending','queryable','archived','rejected','duplicates','lost','intentionallySampled','queueAgeMs','late','outOfOrder','clockAheadRecords','uncertainTime','evaluation'].map(key=>`<dt>${escape(key)}</dt><dd>${escape(String(row[key]))}</dd>`).join('')}</dl><ul>${(row.reasons as {reason:string;count:number;unknownBatches:number}[]).map(reason=>`<li>${escape(reason.reason)}: ${reason.count} records; ${reason.unknownBatches} batches with unknown count</li>`).join('')}</ul></li>`).join('')
 return document('Telemetry delivery',`<p>Accepted batches are durable before acknowledgement. A resumable processor writes retained records and a D1 archive copy together. Sampling is disabled.</p><p>Processor ${control.paused?'paused':'running'}; durable buffer ${control.max_pending_bytes} bytes. Pressure returns 429 with Retry-After.</p><form method="post" action="/api/porthole/v1/ingest/control"><input type="hidden" name="paused" value="${control.paused?'false':'true'}"><button type="submit">${control.paused?'Resume':'Pause'} processor</button></form><form method="post" action="/api/porthole/v1/ingest/drain"><button type="submit">Process buffered batches</button></form><ul>${items || '<li>No authenticated telemetry has arrived. Coverage is Unknown.</li>'}</ul><h2>Supported intake</h2><p>POST /v1/traces, /v1/metrics, /v1/logs and /v1/profiles: OTLP HTTP JSON or protobuf, optionally gzip. Traces, metrics and logs use stable v1; profiles use experimental v1development from opentelemetry-proto v1.9.0. Profile counts are complete profile messages, with original sample values, stacks and dictionary retained. POST /api/v1/write: Prometheus v1 Snappy protobuf float samples. POST /loki/api/v1/push: Loki JSON/gzip JSON or Snappy protobuf.</p><p>Use an ingest credential in Authorization: Bearer, with signal and service/environment/team scope. Supply missing resource scope using X-Porthole-Service, X-Porthole-Environment and X-Porthole-Team, or a single explicit credential grant. X-Scope-OrgID, when supplied, must exactly match every record's team.</p><p>Maximum compressed/decompressed batch: 1 MiB; maximum records: 5,000; Loki accepts timestamps up to two hours old and ten minutes in the future. Batches are atomic. Rejection counts describe the whole refused batch. Original nanoseconds are ordered by event time then immutable record ID.</p><p>Identical signal payloads for a source are retries by default; X-Porthole-Batch-ID gives an explicit identity (1–120 letters, digits, dot, underscore, colon or hyphen). Reuse with changed bytes returns 409. Scope headers form part of default identity. An explicit new identity intentionally creates a separate batch.</p><p>Stock OTLP gRPC uses the separate owner-run receiver documented in docs/otlp.md; this HTTP listener refuses gRPC directly. Remote-write v2/native histograms/exemplars and Pyroscope are unsupported and return explicit diagnostics. Unknown source or buffer loss and rejected/pending records keep delivery coverage Unknown.</p><p><a href="/app/settings/credentials">Credentials</a> · <a href="/api/porthole/v1/ingest/status">Delivery API</a></p>`,200,{forms:true})
}
export async function changeControl(request: Request,env: Bindings) {
 const actor=await authority(request,env,{manage:true,post:true})
 if(actor.session.kind!=='native')fail('native_session_required')
 if(actor.member.role!=='owner' && !Object.values(actor.member.scope).every(values=>values.includes('*')))fail('global_pipeline_authority_required')
 const data=await input(request),paused=data.paused===true||data.paused==='true'?1:data.paused===false||data.paused==='false'?0:fail('invalid_pause',400)
 const max=data.maxPendingBytes===undefined?null:Number(data.maxPendingBytes)
 if(max!==null&&(!Number.isSafeInteger(max)||max<1||max>1073741824))fail('invalid_buffer_capacity',400)
 const result=await env.DB.prepare(`UPDATE porthole_ingest_control SET paused=?,max_pending_bytes=COALESCE(?,max_pending_bytes),revision=revision+1,changed_at=? WHERE singleton=1 AND ${actor.fence} RETURNING paused,max_pending_bytes,revision`).bind(paused,max,Date.now(),...actor.args).all()
 if(!result.results.length)fail('authority_changed',409)
 return result.results[0]
}
export async function recordLoss(request: Request,env: Bindings) {
 const actor=await authority(request,env,{manage:true,post:true})
 if(actor.session.kind!=='native')fail('native_session_required')
 const data=await input(request)
 if(!['source_loss','buffer_loss'].includes(String(data.kind))||!['logs','metrics','traces','profiles'].includes(String(data.signal))||typeof data.sourceId!=='string')fail('invalid_loss_report',400)
 const scope:Scope={services:[String(data.service??'')],environments:[String(data.environment??'')],teams:[String(data.team??'')]}
 if(Object.values(scope).some(values=>!values[0]||values[0]==='*')||!scopeWithin(scope,actor.member.scope))fail('scope_forbidden')
 const count=data.count===null?null:Number(data.count)
 if(count!==null&&(!Number.isSafeInteger(count)||count<1))fail('invalid_loss_count',400)
 const start=nano(data.from),end=nano(data.through)
 if(start>end)fail('invalid_loss_range',400)
 const result=await env.DB.prepare(`INSERT INTO porthole_ingest_events(id,source_id,signal,team,service,environment,occurred_at,kind,reason,record_count,range_start_ns,range_end_ns) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.fence} AND EXISTS(SELECT 1 FROM porthole_ingest_batches b,json_each(b.records) r WHERE b.source_id=? AND b.signal=? AND json_extract(r.value,'$.team')=? AND json_extract(r.value,'$.service')=? AND json_extract(r.value,'$.environment')=?) RETURNING id`).bind(crypto.randomUUID(),data.sourceId,data.signal,data.team,data.service,data.environment,Date.now(),data.kind,data.kind,count,start,end,...actor.args,data.sourceId,data.signal,data.team,data.service,data.environment).all()
 if(!result.results.length)fail('unknown_source_or_authority_changed',409)
 return result.results[0]
}
