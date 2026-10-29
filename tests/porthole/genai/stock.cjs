const assert=require('node:assert/strict')
const {createServer}=require('node:http')
const {providerEdge,marker}=require('./edge.cjs')
;(async()=>{
 const edge=await providerEdge(),packets=[],receipts=[]
 const intake=createServer(async(request,response)=>{
  const parts=[];for await(const part of request)parts.push(part)
  const body=Buffer.concat(parts);packets.push(body.toString('base64'))
  const accepted=await fetch(process.env.PORTHOLE_GENAI_INTAKE,{method:'POST',headers:{'content-type':'application/x-protobuf',authorization:'Bearer '+process.env.PORTHOLE_GENAI_SOURCE},body})
  receipts.push({status:accepted.status,batch:accepted.headers.get('x-porthole-batch')})
  response.writeHead(accepted.status,{'content-type':'application/x-protobuf'});response.end(Buffer.from(await accepted.arrayBuffer()))
 })
 await new Promise(resolve=>intake.listen(0,'127.0.0.1',resolve))
 process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT='http://127.0.0.1:'+intake.address().port+'/v1/traces'
 const {sdk,feature,modelCall,tool}=require('../../../instrumentation/genai/register.cjs')
 const OpenAI=require('openai'),Anthropic=require('@anthropic-ai/sdk')
 const openai=new OpenAI({apiKey:'synthetic-porthole-2740',baseURL:edge.origin+'/v1',maxRetries:0}),anthropic=new Anthropic({apiKey:'synthetic-porthole-2741',baseURL:edge.origin,maxRetries:0})
 let traceId,rootId,toolResult,shippingResult
 try{
 await feature('checkout-assistant',async root=>{
  traceId=root.spanContext().traceId;rootId=root.spanContext().spanId
  const request={model:'synthetic-porthole-retry',messages:[{role:'user',content:marker}],tools:[{type:'function',function:{name:'inventory',parameters:{type:'object',properties:{value:{type:'string'}}}}}]}
  await assert.rejects(()=>modelCall({attempt:1},()=>openai.chat.completions.create(request)))
  const completion=await modelCall({attempt:2},()=>openai.chat.completions.create(request))
  const selected=completion.result.choices[0].message.tool_calls[0]
  toolResult=await tool({name:selected.function.name,callId:selected.id,parent:completion.spanContext},async()=>JSON.parse(selected.function.arguments).value.length)
  const message=await modelCall({},()=>anthropic.messages.create({model:'synthetic-porthole-anthropic',max_tokens:40,messages:[{role:'user',content:marker}],tools:[{name:'shipping',input_schema:{type:'object',properties:{value:{type:'string'}}}}]}))
  const shipping=message.result.content[0]
  shippingResult=await tool({name:shipping.name,callId:shipping.id,parent:message.spanContext},async()=>shipping.input.value.toUpperCase().length)
  await modelCall({streaming:true},async()=>{const stream=await openai.chat.completions.create({model:'synthetic-porthole-openai',messages:[{role:'user',content:marker}],stream:true,stream_options:{include_usage:true}});let chunks=0;for await(const chunk of stream)chunks++;assert.equal(chunks,3)})
  await modelCall({streaming:true},async()=>{const stream=await anthropic.messages.create({model:'synthetic-porthole-anthropic',max_tokens:40,messages:[{role:'user',content:marker}],stream:true});let chunks=0;for await(const chunk of stream)chunks++;assert.equal(chunks,6)})
  await modelCall({},()=>openai.chat.completions.create({model:'synthetic-porthole-missing',messages:[{role:'user',content:marker}]}))
  await assert.rejects(()=>modelCall({},()=>anthropic.messages.create({model:'synthetic-porthole-failed',max_tokens:40,messages:[{role:'user',content:marker}]})))
 })
 await sdk.shutdown()
 assert.ok(receipts.length>0);assert.ok(receipts.every(r=>r.status===200),'real intake accepts stock metadata-only OTLP')
 assert.equal(edge.requests.length,7);assert.equal(toolResult,marker.length);assert.equal(shippingResult,marker.length)
 console.log(JSON.stringify({traceId,rootId,packets,receipts,requests:edge.requests.map(r=>({path:r.path,model:r.input.model,stream:!!r.input.stream})),toolResult,shippingResult}))
 }finally{await sdk.shutdown();await edge.close();await new Promise(resolve=>intake.close(resolve))}
})().catch(error=>{console.error(error.name+': '+error.message.replace(/synthetic-porthole-2701-sensitive-content/g,'[content omitted]'));process.exitCode=1})
