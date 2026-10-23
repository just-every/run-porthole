// Owner-deployed policy. Fail closed; diagnostics never contain keys or values.
const {readFileSync}=require('node:fs')
const {propagation,trace,createContextKey}=require('@opentelemetry/api')
const {createRequire}=require('node:module')
const sdkRequire=createRequire(require.resolve('@opentelemetry/sdk-node'))
const {W3CTraceContextPropagator,W3CBaggagePropagator,CompositePropagator}=sdkRequire('@opentelemetry/core')
const denied=/auth|token|email|name|secret|password|cookie|credential|session|api[-_.]?key|address|phone/i
const diagnostics=createContextKey('porthole.baggage.refusals')
let policy={enabled:false,allowedKeys:[],attributeKeys:[],revision:0}
try {
 const candidate=JSON.parse(readFileSync(process.env.PORTHOLE_BAGGAGE_POLICY,'utf8'))
 const valid=keys=>Array.isArray(keys)&&keys.length<=64&&new Set(keys).size===keys.length&&keys.every(key=>typeof key==='string'&&/^[a-z][a-z0-9_.-]{0,63}$/.test(key))
 if(candidate.version!==1||!Number.isSafeInteger(candidate.revision)||candidate.revision<1||typeof candidate.enabled!=='boolean'||candidate.maxEntries!==8||candidate.maxValueBytes!==256||!valid(candidate.allowedKeys)||!valid(candidate.attributeKeys)||candidate.attributeKeys.some(key=>!candidate.allowedKeys.includes(key)))throw Error()
 policy=candidate
} catch {if(process.env.PORTHOLE_BAGGAGE_POLICY)process.stderr.write('{"porthole.baggage":"policy_unavailable","enabled":false}\n')}
function filter(entries){
 const kept={},reasons={},seen=new Set()
 const refuse=reason=>reasons[reason]=(reasons[reason]??0)+1
 for(const [key,value] of entries){
  let reason
  if(!policy.enabled)reason='disabled'
  else if(denied.test(key))reason='sensitive_key'
  else if(!/^[a-z][a-z0-9_.-]{0,63}$/.test(key)||seen.has(key))reason='invalid_or_duplicate'
  else if(!policy.allowedKeys.includes(key))reason='not_allowlisted'
  else if(typeof value!=='string'||Buffer.byteLength(value,'utf8')>256)reason='value_too_large'
  else if(Object.keys(kept).length>=8)reason='entry_limit'
  seen.add(key)
  if(reason)refuse(reason);else kept[key]={value}
 }
 return {baggage:propagation.createBaggage(kept),reasons}
}
function report(reasons,span){
 if(!Object.keys(reasons).length)return
 process.stderr.write(JSON.stringify({'porthole.baggage':'refused',revision:policy.revision,reasons})+'\n')
 if(span)span.addEvent('porthole.baggage.refused',Object.fromEntries(Object.entries(reasons).map(([key,value])=>['porthole.baggage.'+key,value])))
}
const stock=new W3CBaggagePropagator()
const baggage={
 fields:()=>['baggage'],
 inject(ctx,carrier,setter){
  const current=propagation.getBaggage(ctx),entries=current?.getAllEntries().map(([key,entry])=>[key,entry.value])??[]
  const result=filter(entries);report(result.reasons,trace.getSpan(ctx))
  setter.set(carrier,'baggage','')
  stock.inject(propagation.setBaggage(ctx,result.baggage),carrier,setter)
 },
 extract(ctx,carrier,getter){
  let raw=getter.get(carrier,'baggage');if(Array.isArray(raw))raw=raw.join(',')
  if(typeof raw!=='string'||!raw)return propagation.deleteBaggage(ctx)
  if(Buffer.byteLength(raw)>16384){report({header_too_large:1});return propagation.deleteBaggage(ctx).setValue(diagnostics,{header_too_large:1})}
  const entries=[];let malformed=0
  for(const member of raw.split(',')){
   const item=member.split(';')[0].trim(),equal=item.indexOf('=')
   try {if(equal<1)throw Error();entries.push([item.slice(0,equal).trim(),decodeURIComponent(item.slice(equal+1).trim())])}catch{malformed++}
  }
  const result=filter(entries);if(malformed)result.reasons.malformed=malformed
  report(result.reasons)
  return propagation.setBaggage(ctx,result.baggage).setValue(diagnostics,result.reasons)
 }
}
const processor={
 onStart(span,parent){
  report(parent.getValue(diagnostics)??{},span)
  for(const [key,entry] of filter(propagation.getBaggage(parent)?.getAllEntries().map(([key,entry])=>[key,entry.value])??[]).baggage.getAllEntries())if(policy.enabled&&policy.attributeKeys.includes(key)&&policy.allowedKeys.includes(key)&&!denied.test(key)&&Buffer.byteLength(entry.value,'utf8')<=256)span.setAttribute('baggage.'+key,entry.value)
 },onEnd(){},forceFlush:async()=>{},shutdown:async()=>{}
}
module.exports={propagator:new CompositePropagator({propagators:[new W3CTraceContextPropagator(),baggage]}),processor}
