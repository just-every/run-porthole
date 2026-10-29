// Network edge only. Opened official schemas are the pinned SDK declarations:
// openai 6.27.0: resources/chat/completions/completions.d.ts (ChatCompletion,
// ChatCompletionChunk) and resources/completions.d.ts (CompletionUsage).
// @anthropic-ai/sdk 0.80.0: resources/messages/messages.d.ts (Message, Usage,
// RawMessageStreamEvent) and core/api-error.d.ts (APIError).
const {createServer}=require('node:http')
const marker='synthetic-porthole-2701-sensitive-content'
async function providerEdge(){
 const requests=[]
 const server=createServer(async(request,response)=>{
  const chunks=[];for await(const chunk of request)chunks.push(chunk)
  const input=JSON.parse(Buffer.concat(chunks).toString());requests.push({path:request.url,input})
  const model=input.model
  const json=(body,status=200)=>{response.writeHead(status,{'content-type':'application/json','request-id':'synthetic-porthole-2710'});response.end(JSON.stringify(body))}
  if(model==='synthetic-porthole-failed'||model==='synthetic-porthole-retry'&&requests.filter(r=>r.input.model===model).length===1){
   return json(request.url==='/v1/messages'?{type:'error',error:{type:'invalid_request_error',message:marker},request_id:'synthetic-porthole-2711'}:{error:{message:marker,type:'invalid_request_error',param:null,code:null}},model==='synthetic-porthole-retry'?503:400)
  }
  if(request.url==='/v1/chat/completions'){
   const base={id:'synthetic-porthole-2720',created:1700000000,model:'synthetic-porthole-openai-version',object:input.stream?'chat.completion.chunk':'chat.completion'}
   if(input.stream){
    response.writeHead(200,{'content-type':'text/event-stream'})
    for(const data of [{...base,choices:[{index:0,delta:{role:'assistant',content:marker},finish_reason:null}]},{...base,choices:[{index:0,delta:{},finish_reason:'stop'}]},{...base,choices:[],usage:{prompt_tokens:11,completion_tokens:7,total_tokens:18,prompt_tokens_details:{cached_tokens:3}}}])response.write('data: '+JSON.stringify(data)+'\n\n')
    return response.end('data: [DONE]\n\n')
   }
   return json({...base,choices:[{index:0,message:{role:'assistant',content:null,refusal:null,tool_calls:[{id:'synthetic-porthole-tool-1',type:'function',function:{name:'inventory',arguments:JSON.stringify({value:marker})}}]},finish_reason:'tool_calls',logprobs:null}],...(model==='synthetic-porthole-missing'?{}:{usage:{prompt_tokens:13,completion_tokens:5,total_tokens:18,prompt_tokens_details:{cached_tokens:2}}})})
  }
  if(request.url==='/v1/messages'){
   const message={id:'synthetic-porthole-2730',type:'message',role:'assistant',model:'synthetic-porthole-anthropic-version',stop_reason:input.stream?'end_turn':'tool_use',stop_sequence:null,content:[{type:'tool_use',id:'synthetic-porthole-tool-2',name:'shipping',input:{value:marker}}],usage:{input_tokens:5,output_tokens:3,cache_read_input_tokens:4,cache_creation_input_tokens:2}}
   if(input.stream){
    response.writeHead(200,{'content-type':'text/event-stream'})
    const events=[{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{input_tokens:6,output_tokens:0,cache_read_input_tokens:2,cache_creation_input_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:marker}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:4}},{type:'message_stop'}]
    for(const event of events)response.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n')
    return response.end()
   }
   return json(message)
  }
  return json({error:'not_found'},404)
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 return {origin:'http://127.0.0.1:'+server.address().port,requests,close:()=>new Promise(resolve=>server.close(resolve))}
}
module.exports={providerEdge,marker}
