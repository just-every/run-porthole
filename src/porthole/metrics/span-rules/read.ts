import type {Bindings} from '../../../auth.server'
import {authority,allScope,emptyScope,fail,scopeWithin} from '../../security/authority'
import {verifyCredential} from '../../credentials/verify'
import {input} from '../../security/input'
import {nano} from '../../ingest/model'
import {privateHeaders} from '../../document'
import {scope,type Definition} from './model'

export async function queryRule(request:Request,env:Bindings,download=false):Promise<Response> {
 if(request.method!=='POST')fail('method_not_allowed',405)
 const data=await input(request),bearer=request.headers.has('authorization')
 const native=bearer?null:await authority(request,env,{post:true})
 const credential=bearer?await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true}):null
 if(native&&!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(native.member.role))fail('telemetry_forbidden')
 if(credential&&!credential.credential.scope.signals.includes('metrics'))fail('credential_scope_forbidden')
 const from=nano(data.from),through=nano(data.through)
 if(from>=through||!Number.isSafeInteger(data.revision)||Number(data.revision)<1)fail('invalid_query_range',400)
 const rule=await env.DB.prepare("SELECT definition,from_sequence FROM porthole_metric_rules WHERE id=? AND revision=? AND state='active'").bind(data.id,data.revision).first<{definition:string;from_sequence:number}>()
 if(!rule)fail('rule_unavailable',404)
 const d=JSON.parse(rule.definition) as Definition,held=native?.member.scope??credential!.credential.scope
 if(!scopeWithin(scope(d),held))fail('scope_forbidden')
 const args=[data.id,data.revision,from,through],count=await env.DB.prepare('SELECT COUNT(*) AS n FROM porthole_metric_points WHERE rule_id=? AND revision=? AND event_time_ns>=? AND event_time_ns<?').bind(...args).first<{n:number}>()
 if((count?.n??0)>100000)fail('metric_scan_limit',422)
 const statements=(fence:{sql:string;args:unknown[]})=>[
  env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${fence.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...fence.args),
  env.DB.prepare(`WITH ranked AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY dimensions ORDER BY value,batch_id,ordinal) AS position,COUNT(*) OVER(PARTITION BY dimensions) AS n FROM porthole_metric_points WHERE rule_id=? AND revision=? AND event_time_ns>=? AND event_time_ns<?)
   SELECT dimensions,COUNT(*) AS count,COUNT(value) AS valid,SUM(value) AS sum,MIN(value) AS min,MAX(value) AS max,
   MAX(CASE WHEN position=CAST((n*50+99)/100 AS INTEGER) THEN value END) AS p50,MAX(CASE WHEN position=CAST((n*95+99)/100 AS INTEGER) THEN value END) AS p95,MAX(CASE WHEN position=CAST((n*99+99)/100 AS INTEGER) THEN value END) AS p99,
   MIN(json_array(trace_id,span_id,event_time_ns)) AS exemplar FROM ranked GROUP BY dimensions ORDER BY dimensions`).bind(...args),
  env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_events WHERE signal='traces' AND service=? AND environment=? AND team=? AND kind IN ('source_loss','buffer_loss','rejected') AND (range_start_ns IS NULL OR range_start_ns<? AND range_end_ns>=?)").bind(d.service,d.environment,d.team,through,from),
  env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.signal='traces' AND b.state='pending' AND b.sequence>=? AND json_extract(j.value,'$.service')=? AND json_extract(j.value,'$.environment')=? AND json_extract(j.value,'$.team')=? AND json_extract(j.value,'$.eventTimeNs')>=? AND json_extract(j.value,'$.eventTimeNs')<? AND COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted')=? AND json_extract(j.value,'$.payload.record.name')=?").bind(rule.from_sequence,d.service,d.environment,d.team,from,through,d.inputStage,d.spanName),
 ]
 let results:D1Result[]
 if(bearer){
  const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:scope(d),dataScope:allScope,scannedBytes:(count?.n??0)*128,writes(fence,latest){if(!latest.signals.includes('metrics'))fail('credential_scope_forbidden');return statements(fence)}})
  results=auth.results
 }else results=await env.DB.batch(statements({sql:native!.fence,args:native!.args}))
 const groups=results[1].results as unknown as {dimensions:string;count:number;valid:number;sum:number|null;min:number|null;max:number|null;p50:number|null;p95:number|null;p99:number|null;exemplar:string}[]
 const losses=Number((results[2].results[0] as {n:number}|undefined)?.n??0),pending=Number((results[3].results[0] as {n:number}|undefined)?.n??0)
 const incomplete=!count?.n||d.upstream!=='complete'||!!losses||!!pending||groups.some(g=>g.valid!==g.count||JSON.parse(g.dimensions).includes('[other]'))
 const result={id:data.id,revision:data.revision,definition:d,from,through,interval:'half-open',temporality:'delta',inputStage:'accepted-before-retention',coverage:{status:incomplete?'incomplete':'accepted-input-complete',upstream:d.upstream,independentlyVerified:false,lossEvents:losses,pendingRecords:pending},groups:groups.map(g=>{const [traceId,spanId,eventTimeNs]=JSON.parse(g.exemplar);return {...g,dimensions:Object.fromEntries(d.dimensions.map((dim,i)=>[dim.key,JSON.parse(g.dimensions)[i]])),exemplar:{traceId,spanId,eventTimeNs,service:d.service,environment:d.environment,team:d.team},quantiles:g.valid===g.count?{p50:g.p50,p95:g.p95,p99:g.p99}:null}})}
 if(download)return new Response(JSON.stringify(result)+'\n',{headers:{...privateHeaders,'content-type':'application/x-ndjson','content-disposition':'attachment; filename="span-metrics.ndjson"'}})
 return Response.json(result,{headers:privateHeaders})
}
