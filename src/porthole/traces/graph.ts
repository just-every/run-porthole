import { canonical } from '../ingest/model'

export interface TraceRecord {
 id:string; service:string; environment:string; team:string; span_id:string; trace_id:string
 payload:{record:Record<string,unknown>;resource?:Record<string,unknown>;scope?:Record<string,unknown>}
}
export interface TraceSpan {
 spanId:string; parentSpanId:string|null; service:string; environment:string; team:string
 name:string; kind:number; startTimeNs:string; endTimeNs:string; durationNs:string
 resource:Record<string,unknown>; instrumentation:Record<string,unknown>; attributes:unknown
 status:unknown; events:unknown; links:unknown; copies:number; conflict:boolean
 parent:string|null; depth:number; diagnostics:string[]
}
/** Identity, never timestamp proximity, determines topology. Conflicting IDs
 * remain separate variants and cannot become a parent. Missing parents may be
 * outside the reader's scope; that reason is deliberately indistinguishable. */
export function traceGraph(traceId:string,records:TraceRecord[],truncated:boolean) {
 const groups=new Map<string,Map<string,TraceRecord[]>>()
 for(const row of records) {
  const variants=groups.get(row.span_id)??new Map<string,TraceRecord[]>()
  const fingerprint=canonical({service:row.service,environment:row.environment,team:row.team,record:row.payload.record,resource:row.payload.resource??{},scope:row.payload.scope??{}})
  const copies=variants.get(fingerprint)??[];copies.push(row);variants.set(fingerprint,copies);groups.set(row.span_id,variants)
 }
 const spans:TraceSpan[]=[]
 for(const [spanId,variants] of groups) for(const copies of variants.values()) {
  const row=copies[0],raw=row.payload.record,start=BigInt(String(raw.startTimeUnixNano??'0')),end=BigInt(String(raw.endTimeUnixNano??'0'))
  const parentSpanId=typeof raw.parentSpanId==='string'&&raw.parentSpanId?raw.parentSpanId.toLowerCase():null
  spans.push({spanId,parentSpanId,service:row.service,environment:row.environment,team:row.team,
   name:String(raw.name??'(unnamed span)'),kind:Number(raw.kind??0),startTimeNs:start.toString(),endTimeNs:end.toString(),durationNs:(end-start).toString(),
   resource:row.payload.resource??{},instrumentation:row.payload.scope??{},attributes:raw.attributes??[],status:raw.status??{},events:raw.events??[],links:raw.links??[],
   copies:copies.length,conflict:variants.size>1,parent:null,depth:0,diagnostics:variants.size>1?['conflicting_span_identity']:[]})
 }
 const unique=new Map(spans.filter(span=>!span.conflict).map(span=>[span.spanId,span]))
 for(const span of spans) {
  if(!span.parentSpanId)continue
  const seen=new Set([span.spanId]);let ancestor=span.parentSpanId,depth=0,broken=false
  while(ancestor) {
   if(seen.has(ancestor)){span.diagnostics.push('cyclic_parent_links');broken=true;break}
   seen.add(ancestor)
   const parent=unique.get(ancestor)
   if(!parent){span.diagnostics.push(groups.has(ancestor)?'ambiguous_parent_identity':'missing_or_out_of_scope_parent');broken=true;break}
   depth++;ancestor=parent.parentSpanId??''
  }
  if(!broken&&!span.conflict){span.parent=span.parentSpanId;span.depth=depth}
 }
 spans.sort((a,b)=>a.startTimeNs===b.startTimeNs?a.spanId.localeCompare(b.spanId):BigInt(a.startTimeNs)<BigInt(b.startTimeNs)?-1:1)
 const starts=spans.map(span=>BigInt(span.startTimeNs)),ends=spans.map(span=>BigInt(span.endTimeNs))
 const start=starts.reduce((min,n)=>n<min?n:min,starts[0]??0n),end=ends.reduce((max,n)=>n>max?n:max,ends[0]??0n)
 const diagnostics=[...new Set(spans.flatMap(span=>span.diagnostics))]
 if(truncated)diagnostics.push('trace_record_limit_reached')
 const roots=spans.filter(span=>!span.parentSpanId)
 if(spans.length&&roots.length!==1)diagnostics.push(roots.length?'multiple_roots':'no_root')
 return {traceId,status:diagnostics.length?'Incomplete':spans.length?'Connected':'Empty',startTimeNs:start.toString(),endTimeNs:end.toString(),durationNs:(end-start).toString(),
  recordCount:records.length,spanCount:groups.size,variantCount:spans.length,truncated,diagnostics,spans}
}
export type TraceGraph=ReturnType<typeof traceGraph>
