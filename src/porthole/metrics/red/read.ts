import type { Bindings } from '../../../auth.server'
import { verifyCredential } from '../../credentials/verify'
import { privateHeaders } from '../../document'
import { allScope, authority, fail, scopeWithin } from '../../security/authority'
import { input } from '../../security/input'
import { selection } from './model'

interface Group {endpoint:string;hits:number;errors:number;valid_durations:number;duration_sum_ns:number|null;p50:number|null;p95:number|null;p99:number|null}
interface Ledger {scanned:number;accepted:number;pending:number}
interface Loss {kind:string;reason:string;records:number;events:number;unknown_batches:number}
const maximum=100000

export async function queryRed(request:Request,env:Bindings):Promise<Response> {
 const d=selection(await input(request)),bearer=request.headers.has('authorization')
 const native=bearer?null:await authority(request,env,{post:true})
 const credential=bearer?await verifyCredential(request,env,{action:'telemetry.read',scope:d.scope,dataScope:allScope,inspectOnly:true}):null
 if(native&&!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(native.member.role))fail('telemetry_forbidden')
 if(credential&&!credential.credential.scope.signals.includes('metrics'))fail('credential_scope_forbidden')
 if(!scopeWithin(d.scope,native?.member.scope??credential!.credential.scope))fail('scope_forbidden')
 const args=[d.team,d.service,d.environment,d.inputStage,d.from,d.through]
 const points=`SELECT * FROM porthole_red_points WHERE team=? AND service=? AND environment=? AND input_stage=? AND event_time_ns>=? AND event_time_ns<? LIMIT ${maximum+1}`
 const count=await env.DB.prepare(`SELECT COUNT(*) AS n FROM (${points})`).bind(...args).first<{n:number}>()
 if(Number(count?.n??0)>maximum)fail('red_scan_limit',422)
 const statements=(fence:{sql:string;args:unknown[]})=>[
  env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${fence.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...fence.args),
  env.DB.prepare(`WITH points AS (${points}),ranked AS (
   SELECT *,ROW_NUMBER() OVER(PARTITION BY endpoint ORDER BY duration_ns IS NULL,duration_ns,batch_id,ordinal) AS position,COUNT(duration_ns) OVER(PARTITION BY endpoint) AS n FROM points)
   SELECT endpoint,COUNT(*) AS hits,SUM(error) AS errors,COUNT(duration_ns) AS valid_durations,SUM(CAST(duration_ns AS REAL)) AS duration_sum_ns,
   MAX(CASE WHEN position=CAST((n*50+99)/100 AS INTEGER) THEN duration_ns END) AS p50,
   MAX(CASE WHEN position=CAST((n*95+99)/100 AS INTEGER) THEN duration_ns END) AS p95,
   MAX(CASE WHEN position=CAST((n*99+99)/100 AS INTEGER) THEN duration_ns END) AS p99
   FROM ranked GROUP BY endpoint ORDER BY endpoint`).bind(...args),
  // Source envelopes have no per-record scope index. Bound the entire trace
  // ledger before filtering, then refuse a larger installation, never infer
  // completeness from just the derived rows or a truncated source population.
  env.DB.prepare(`WITH ledger AS (
   SELECT b.state,b.sampling_pending,json_extract(j.value,'$.team') AS team,json_extract(j.value,'$.service') AS service,json_extract(j.value,'$.environment') AS environment,
    COALESCE(json_extract(j.value,'$.payload.inputStage'),'accepted') AS input_stage,json_extract(j.value,'$.eventTimeNs') AS event_time_ns
   FROM porthole_ingest_batches b,json_each(b.records) j WHERE b.signal='traces' LIMIT ${maximum+1})
   SELECT COUNT(*) AS scanned,COALESCE(SUM(CASE WHEN team=? AND service=? AND environment=? AND input_stage=? AND event_time_ns>=? AND event_time_ns<? THEN 1 ELSE 0 END),0) AS accepted,
   COALESCE(SUM(CASE WHEN team=? AND service=? AND environment=? AND input_stage=? AND event_time_ns>=? AND event_time_ns<? AND (state='pending' OR sampling_pending=1) THEN 1 ELSE 0 END),0) AS pending FROM ledger`).bind(...args,...args),
  env.DB.prepare(`WITH losses AS (SELECT kind,reason,record_count FROM porthole_ingest_events WHERE signal='traces' AND team=? AND service=? AND environment=? AND kind IN ('source_loss','buffer_loss','rejected') AND (range_start_ns IS NULL OR range_start_ns<? AND range_end_ns>=?) LIMIT ${maximum+1})
   SELECT kind,reason,SUM(COALESCE(record_count,0)) AS records,COUNT(*) AS events,SUM(CASE WHEN record_count IS NULL THEN 1 ELSE 0 END) AS unknown_batches FROM losses GROUP BY kind,reason ORDER BY kind,reason`).bind(d.team,d.service,d.environment,d.through,d.from),
 ]
 let results:D1Result[]
 if(bearer){
  const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:d.scope,dataScope:allScope,scannedBytes:(Number(count?.n??0)+maximum+1)*128,writes(fence,latest){
   if(!latest.signals.includes('metrics'))fail('credential_scope_forbidden')
   return statements(fence)
  }})
  results=auth.results
 }else results=await env.DB.batch(statements({sql:native!.fence,args:native!.args}))
 const groups=results[1].results as unknown as Group[],ledger=results[2].results[0] as unknown as Ledger,losses=results[3].results as unknown as Loss[]
 const derivedInputs=groups.reduce((n,g)=>n+g.hits,0),lossEvents=losses.reduce((n,l)=>n+l.events,0)
 if(derivedInputs>maximum||ledger.scanned>maximum||lossEvents>maximum)fail('red_scan_limit',422)
 const missingContributions=Math.max(0,ledger.accepted-derivedInputs),invalidDurations=groups.reduce((n,g)=>n+g.hits-g.valid_durations,0)
 const complete=d.inputStage==='pre-sampling'&&ledger.accepted>0&&derivedInputs===ledger.accepted&&!ledger.pending&&!lossEvents&&!invalidDurations
 return Response.json({scope:d.scope,from:d.from,through:d.through,interval:'half-open',inputStage:d.inputStage,population:'accepted-spans-before-retention',temporality:'delta',
  endpointDefinition:'http.route when present, otherwise original span name',errorDefinition:'OTLP status ERROR, HTTP status 500–599, or nonzero numeric gRPC status',
  coverage:{status:complete?'accepted-input-complete':'incomplete',upstream:'unknown',independentlyVerified:false,acceptedInputs:ledger.accepted,derivedInputs,missingContributions,pendingRecords:ledger.pending,invalidDurations,lossEvents,losses},
  query:{maximumScannedInputs:maximum,sourceLedgerScanned:ledger.scanned,sourceLedgerBudget:'installation-wide traces',quantileMethod:'nearest-rank',durationUnit:'ns',source:'native-span-input',agentStatsIncluded:false},
  groups:groups.map(g=>({endpoint:g.endpoint,hits:g.hits,errors:g.errors,ratePerSecond:g.hits/(Number(BigInt(d.through)-BigInt(d.from))/1e9),duration:{unit:'ns',count:g.valid_durations,sum:g.duration_sum_ns,quantiles:g.valid_durations===g.hits?{p50:g.p50,p95:g.p95,p99:g.p99}:null}})),
 },{headers:privateHeaders})
}
