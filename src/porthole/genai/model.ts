import {canonical} from '../ingest/model'
import {traceGraph,type TraceRecord} from '../traces/graph'

const value=(attrs:unknown,key:string):unknown=>{
 if(!Array.isArray(attrs))return undefined
 const row=attrs.find(a=>a?.key===key)?.value
 return row?.stringValue??row?.intValue??row?.doubleValue??row?.boolValue
}
const text=(attrs:unknown,key:string)=>{const v=value(attrs,key);return typeof v==='string'?v:null}
const counter=(attrs:unknown,keys:string[])=>{
 for(const key of keys){const raw=value(attrs,key);if(raw===undefined)continue;if(typeof raw!=='number'&&(typeof raw!=='string'||!/^\d+$/.test(raw)))return null;const n=Number(raw);return Number.isSafeInteger(n)&&n>=0?n:null}
 return null
}
export function genaiView(records:TraceRecord[],truncated:boolean) {
 const traces=new Map<string,TraceRecord[]>()
 for(const record of records){const rows=traces.get(record.trace_id)??[];rows.push(record);traces.set(record.trace_id,rows)}
 const calls=[]
 let replayCopies=0
 for(const [traceId,rows]of traces){
  const graph=traceGraph(traceId,rows,truncated)
  for(const span of graph.spans){
   const a=span.attributes,operation=text(a,'gen_ai.operation.name')
   if(!operation)continue
   const provider=text(a,'gen_ai.provider.name')??text(a,'gen_ai.system'),tool=operation==='execute_tool'
   const usage={inputTokens:counter(a,['gen_ai.usage.input_tokens']),outputTokens:counter(a,['gen_ai.usage.output_tokens']),cacheReadInputTokens:counter(a,['gen_ai.usage.cache_read.input_tokens','gen_ai.usage.cache_read_input_tokens']),cacheCreationInputTokens:counter(a,['gen_ai.usage.cache_creation.input_tokens','gen_ai.usage.cache_creation_input_tokens'])}
   const failed=Number((span.status as {code?:number}).code)===2
   // Conflicting identities are evidence, never additive usage. A partial
   // failed stream may still carry observed counters; missing fields stay null.
   if(span.conflict)for(const key of Object.keys(usage) as (keyof typeof usage)[])usage[key]=null
   replayCopies+=span.copies-1
   calls.push({traceId,spanId:span.spanId,parentSpanId:span.parentSpanId,parent:span.parent,diagnostics:span.diagnostics,conflict:span.conflict,copies:span.copies,
    operation,provider,requestModel:text(a,'gen_ai.request.model'),responseModel:text(a,'gen_ai.response.model'),responseId:text(a,'gen_ai.response.id'),
    conventions:text(a,'porthole.gen_ai.conventions')??'undeclared',instrumentation:span.instrumentation,
    feature:text(a,'porthole.gen_ai.feature'),toolName:text(a,'gen_ai.tool.name'),toolCallId:text(a,'gen_ai.tool.call.id'),
    streaming:typeof value(a,'porthole.gen_ai.streaming')==='boolean'?value(a,'porthole.gen_ai.streaming'):null,attempt:counter(a,['porthole.gen_ai.attempt']),
    startTimeNs:span.startTimeNs,durationNs:span.durationNs,status:failed?'failed':'completed',usage:tool?null:usage,
    usageState:tool?'not_applicable':span.conflict?'conflicting_identity':usage.inputTokens===null||usage.outputTokens===null?'missing':'observed',
    usd:null,rateSource:null,reconciliation:{state:'unavailable',reason:'authorized_provider_report_and_rate_evidence_missing'},service:span.service,environment:span.environment,team:span.team})
  }
 }
 const groups=new Map<string,{provider:string|null;model:string|null;feature:string|null;calls:number;failed:number;missingUsage:number;observedInputTokens:number;observedOutputTokens:number;observedCacheReadInputTokens:number;observedCacheCreationInputTokens:number;missingCacheUsage:number;usd:null}>()
 for(const call of calls.filter(call=>call.usage!==null)){
  const key=canonical([call.provider,call.responseModel??call.requestModel,call.feature])
  const group=groups.get(key)??{provider:call.provider,model:call.responseModel??call.requestModel,feature:call.feature,calls:0,failed:0,missingUsage:0,observedInputTokens:0,observedOutputTokens:0,observedCacheReadInputTokens:0,observedCacheCreationInputTokens:0,missingCacheUsage:0,usd:null}
  group.calls++;if(call.status==='failed')group.failed++
  if(call.usageState!=='observed')group.missingUsage++
  group.observedInputTokens+=call.usage!.inputTokens??0;group.observedOutputTokens+=call.usage!.outputTokens??0
  group.observedCacheReadInputTokens+=call.usage!.cacheReadInputTokens??0;group.observedCacheCreationInputTokens+=call.usage!.cacheCreationInputTokens??0
  if(call.usage!.cacheReadInputTokens===null||call.usage!.cacheCreationInputTokens===null)group.missingCacheUsage++
  groups.set(key,group)
 }
 return {contentCapture:'disabled',basis:'observed_span_metadata',coverage:truncated?'partial_page':'selected_page',replayCopies,calls,groups:[...groups.values()],usd:null,reconciliation:{state:'unavailable',reason:'authorized_provider_report_and_rate_evidence_missing'}}
}
export type GenAIView=ReturnType<typeof genaiView>
