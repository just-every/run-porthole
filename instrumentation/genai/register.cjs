// Load this module before either provider SDK. This registration never enables
// content capture, provider log export or paid requests by itself.
const {NodeSDK}=require('@opentelemetry/sdk-node')
const {OTLPTraceExporter}=require('@opentelemetry/exporter-trace-otlp-proto')
const {OpenAIInstrumentation}=require('@opentelemetry/instrumentation-openai')
const {AnthropicInstrumentation}=require('@traceloop/instrumentation-anthropic')
const {context,trace,createContextKey,SpanStatusCode}=require('@opentelemetry/api')
const {BatchSpanProcessor}=require('node:module').createRequire(require.resolve('@opentelemetry/sdk-node'))('@opentelemetry/sdk-trace')
const featureKey=createContextKey('porthole.genai.feature'),callKey=createContextKey('porthole.genai.call')
const openai=new OpenAIInstrumentation({captureMessageContent:false})
// The stock plugin reads an environment override during construction. The
// supported metadata-only registration explicitly disables that override too.
openai.setConfig({captureMessageContent:false})
const anthropic=new AnthropicInstrumentation({traceContent:false})
const metadata={
 onStart(span,parent){
  const feature=parent.getValue(featureKey),call=parent.getValue(callKey)
  if(feature)span.setAttribute('porthole.gen_ai.feature',feature)
  const a=span.attributes,provider=a['gen_ai.provider.name']??a['gen_ai.system']
  span.setAttribute('porthole.gen_ai.conventions',provider==='anthropic'?'otel-genai-1.40.0':'otel-genai-1.36.0')
  if(provider&&call){call.spanContext=span.spanContext();span.setAttribute('porthole.gen_ai.streaming',call.streaming);span.setAttribute('porthole.gen_ai.attempt',call.attempt)}
 },
 onEnd(span){
  // Provider exception text may repeat a request or response body even when
  // content capture is off. Keep its type and failure code, never that text.
  if(span.status)delete span.status.message
  for(const event of span.events??[])for(const key of Object.keys(event.attributes??{}))if(key!=='exception.type')delete event.attributes[key]
 },
 forceFlush:async()=>{},shutdown:async()=>{},
}
const sdk=new NodeSDK({spanProcessors:[metadata,new BatchSpanProcessor({exporter:new OTLPTraceExporter()})],instrumentations:[openai,anthropic]})
sdk.start()
const tracer=()=>trace.getTracer('porthole.genai','1.0.0')
const label=value=>{if(typeof value!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(value))throw Error('invalid_genai_metadata_label');return value}
async function feature(name,run){
 label(name)
 return context.with(context.active().setValue(featureKey,name),()=>tracer().startActiveSpan('genai.feature',async span=>{try{return await run(span)}catch(error){span.setStatus({code:SpanStatusCode.ERROR});throw error}finally{span.end()}}))
}
async function modelCall({streaming=false,attempt=1},run){
 if(typeof streaming!=='boolean'||!Number.isSafeInteger(attempt)||attempt<1)throw Error('invalid_genai_call_metadata')
 const state={streaming,attempt,spanContext:null}
 const result=await context.with(context.active().setValue(callKey,state),run)
 return {result,spanContext:state.spanContext}
}
async function tool({name,callId,parent},run){
 label(name);label(callId)
 const parentContext=parent?trace.setSpanContext(context.active(),parent):context.active()
 return context.with(parentContext,()=>tracer().startActiveSpan('execute_tool '+name,{attributes:{'gen_ai.operation.name':'execute_tool','gen_ai.tool.name':name,'gen_ai.tool.call.id':callId}},async span=>{try{return await run()}catch(error){span.setStatus({code:SpanStatusCode.ERROR});throw error}finally{span.end()}}))
}
module.exports={sdk,feature,modelCall,tool}
