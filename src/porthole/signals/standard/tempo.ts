import { canonical, base64 } from '../../ingest/model'
import { encode } from '../../ingest/otlp-proto'
import { traceGraph, type TraceRecord } from '../../traces/graph'
import type { StandardRow } from './read'

/** Tempo 2.8 HTTP trace-by-ID v1: Trace.batches contains OTLP ResourceSpans.
 * Protobuf IDs remain bytes; protobuf JSON IDs use base64, as stock Tempo does. */
export function tempoTrace(traceId:string,rows:StandardRow[]) {
 const unique=[...new Map(rows.map(row=>[canonical({record:row.payload.record,resource:row.payload.resource,scope:row.payload.scope,resourceSchemaUrl:row.payload.resourceSchemaUrl,scopeSchemaUrl:row.payload.scopeSchemaUrl}),row])).values()]
 const graph=traceGraph(traceId,unique as unknown as TraceRecord[],false)
 const batches=unique.map(row=>({resource:row.payload.resource,schemaUrl:row.payload.resourceSchemaUrl,
  scopeSpans:[{scope:row.payload.scope,schemaUrl:row.payload.scopeSchemaUrl,spans:[row.payload.record]}]}))
 const jsonIds=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(jsonIds)
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,['traceId','spanId','parentSpanId'].includes(key)&&typeof item==='string'?base64(new Uint8Array(item.match(/../g)?.map(n=>parseInt(n,16))??[])):jsonIds(item)]))
  return value
 }
 return {protobuf:encode({resourceSpans:batches},'Traces'),json:jsonIds({batches}),headers:{
  // A connected authorized graph is never evidence of a complete original
  // trace: other children, unsent spans or sampled spans may be absent.
  'x-porthole-trace-completeness':'partial',
  'x-porthole-trace-evidence':graph.diagnostics.length?graph.diagnostics.join(','):'authorized-retained-spans-only',
 }}
}
