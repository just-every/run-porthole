import type { Bindings } from '../../auth.server'
import { fail } from '../security/authority'
import type { Definition } from './model'

interface RecordRow {id:string;event_time_ns:string;payload:string;late:number}
const ns=(ms:number)=>(BigInt(ms)*1000000n).toString().padStart(20,'0')
const integer=(v:unknown):bigint|null=>typeof v==='string'&&/^(0|[1-9][0-9]{0,29})$/.test(v)?BigInt(v):typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?BigInt(v):null
export async function evaluate(env:Bindings,d:Definition,from:number,through:number) {
 const signal=d.type==='event-ratio'?'traces':'metrics',args=[d.sourceId,signal,d.scope.services[0],d.scope.environments[0],d.scope.teams[0]]
 const filter='source_id=? AND signal=? AND service=? AND environment=? AND team=?'
 const rows=(await env.DB.prepare(`SELECT id,event_time_ns,payload,late FROM porthole_telemetry_records WHERE ${filter} AND event_time_ns>=? AND event_time_ns<? ORDER BY event_time_ns,id LIMIT 20001`).bind(...args,ns(from),ns(through)).all<RecordRow>()).results
 if(rows.length>20000)fail('slo_scan_limit',422)
 let total=0n,good=0n,excluded=0,invalid=0,late=0,relevant=0
 const pairs=new Map<string,{good:bigint[];total:bigint[]}>()
 for(const row of rows) {
  const payload=JSON.parse(row.payload),record=payload.record
  if(d.type==='event-ratio'&&Number(record.kind)!==2)continue
  if(d.type==='metric-ratio'&&![d.goodMetric,d.totalMetric].includes(payload.metric?.name))continue
  relevant++;late+=row.late
  const at=BigInt(row.event_time_ns)
  if(d.type==='event-ratio'&&d.exclusions.some(e=>at>=BigInt(e.from)*1000000n&&at<BigInt(e.through)*1000000n)){excluded++;continue}
  if(d.type==='event-ratio') {
   total++
   const start=integer(record.startTimeUnixNano),end=integer(record.endTimeUnixNano)
   if(start===null||end===null||end<start||![0,1,2].includes(Number(record.status?.code??0))){invalid++;continue}
   if(Number(record.status?.code??0)!==2&&(d.latencyMs===null||end-start<=BigInt(d.latencyMs)*1000000n))good++
  } else {
   // Only integer, monotonic DELTA sums with no point dimensions are supported.
   // Cumulative resets, gauges, ambiguous series and missing pairs stay Unknown.
   const count=integer(record.asInt??record.asDouble)
   if(payload.metricKind!=='sum'||Number(payload.metric.sum?.aggregationTemporality)!==1||payload.metric.sum?.isMonotonic!==true||count===null||record.flags&&Number(record.flags)!==0||record.attributes?.length){invalid++;continue}
   const start=integer(record.startTimeUnixNano)
   if(start===null||start>=at||start<BigInt(from)*1000000n){invalid++;continue}
   if(d.exclusions.some(e=>start>=BigInt(e.from)*1000000n&&at<=BigInt(e.through)*1000000n)){excluded++;continue}
   if(d.exclusions.some(e=>start<BigInt(e.through)*1000000n&&at>BigInt(e.from)*1000000n)){invalid++;continue}
   const key=String(start)+':'+row.event_time_ns,pair=pairs.get(key)??{good:[],total:[]}
   pair[payload.metric.name===d.goodMetric?'good':'total'].push(count);pairs.set(key,pair)
  }
 }
 if(d.type==='metric-ratio') {
  let previousEnd=-1n
  for(const [key,pair] of [...pairs].sort(([a],[b])=>BigInt(a.split(':')[0])<BigInt(b.split(':')[0])?-1:1)) {
   const [start,end]=key.split(':').map(BigInt)
   if(pair.good.length!==1||pair.total.length!==1||pair.good[0]>pair.total[0]||start<previousEnd){invalid++;continue}
   previousEnd=end;good+=pair.good[0];total+=pair.total[0]
  }
 }
 const bad=total-good,allowance=BigInt(1000000-d.targetPpm),budgetNumerator=total*allowance,spentNumerator=bad*1000000n
 const losses=await env.DB.prepare(`SELECT COUNT(*) AS n FROM porthole_ingest_events WHERE ${filter} AND kind IN ('source_loss','buffer_loss','rejected') AND occurred_at>=? AND occurred_at<?`).bind(...args,from,Date.now()+1).first<{n:number}>()
 const pending=await env.DB.prepare("SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE source_id=? AND signal=? AND state='pending'").bind(d.sourceId,signal).first<{n:number}>()
 // Intake has no independently verified complete-traffic manifest yet. A ratio
 // is calculated evidence, never a claim of observed healthy service.
 const coverage={status:invalid||losses?.n||pending?.n?'incomplete':'unverified',reason:total===0n?'No eligible traffic; health is Unknown.':'Full unsampled source coverage is not independently verified.',scanned:rows.length,relevant,excludedRecords:excluded,invalidRecords:invalid,lateRecords:late,lossEvents:losses?.n??0,pendingBatches:pending?.n??0}
 return {from,through,interval:'half-open',signal,sourceId:d.sourceId,definition:d,good:String(good),total:String(total),bad:String(bad),
  budget:{allowed:{numerator:String(budgetNumerator),denominator:'1000000'},spent:String(bad),remaining:{numerator:String(budgetNumerator-spentNumerator),denominator:'1000000'},consumed:total===0n?null:{numerator:String(spentNumerator),denominator:String(budgetNumerator)}},
  coverage,health:'Unknown',budget75:total===0n||invalid||losses?.n||pending?.n?'Unknown':spentNumerator*4n>=budgetNumerator*3n?'crossed':'below'}
}
