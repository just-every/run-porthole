import { invalid } from '../ingest/model'

// Content consent has no supported activation door yet. This is an admission
// guard, before any original wire or normalized envelope is made durable.
const metadata = new Set([
 'gen_ai.system','gen_ai.provider.name','gen_ai.operation.name','gen_ai.request.model','gen_ai.response.model','gen_ai.response.id',
 'gen_ai.request.max_tokens','gen_ai.request.temperature','gen_ai.request.top_p','gen_ai.request.top_k','gen_ai.request.frequency_penalty','gen_ai.request.presence_penalty',
 'gen_ai.response.finish_reasons','gen_ai.usage.input_tokens','gen_ai.usage.output_tokens','gen_ai.usage.total_tokens',
 'gen_ai.usage.cache_read.input_tokens','gen_ai.usage.cache_creation.input_tokens','gen_ai.usage.cache_read_input_tokens','gen_ai.usage.cache_creation_input_tokens',
 'gen_ai.tool.name','gen_ai.tool.call.id','gen_ai.tool.type',
 'porthole.gen_ai.conventions','porthole.gen_ai.feature','porthole.gen_ai.attempt','porthole.gen_ai.streaming',
])
const protectedKey = (key:string) => /^(?:gen_ai|llm|openai|anthropic)\./i.test(key) && !metadata.has(key)
const contentKey = (key:string) => /^(?:prompt|completion|messages|tool_arguments|tool_result|input_messages|output_messages)$/i.test(key)
const scalar = (v:unknown):boolean => typeof v==='string'||typeof v==='number'||typeof v==='boolean'
export function assertGenAIMetadata(value:unknown):void {
 function walk(value:unknown,genai=false):void {
  if(!value||typeof value!=='object')return
  if(Array.isArray(value)){for(const entry of value)walk(entry,genai);return}
  const row=value as Record<string,unknown>
  const attrs=Array.isArray(row.attributes)?row.attributes as Record<string,unknown>[]:[]
  const marked=genai||attrs.some(a=>typeof a.key==='string'&&/^(?:gen_ai|llm|porthole\.gen_ai)\./.test(a.key))
  if(typeof row.key==='string'&&(protectedKey(row.key)||marked&&contentKey(row.key)))invalid('genai_content_not_authorized')
  if(typeof row.key==='string'&&metadata.has(row.key)){
   const v=row.value as Record<string,unknown>|undefined
   const plain=v&&(v.stringValue??v.intValue??v.doubleValue??v.boolValue)
   if(!scalar(plain)&&!(row.key==='gen_ai.response.finish_reasons'&&v?.arrayValue))invalid('genai_metadata_invalid')
   if(typeof plain==='string'&&(plain.length>160||/[\u0000-\u001f\u007f]/.test(plain)))invalid('genai_metadata_invalid')
  }
  if(marked){
   if(row.body!==undefined||row.status&&typeof row.status==='object'&&(row.status as Record<string,unknown>).message)invalid('genai_content_not_authorized')
   if(row.events!==undefined){
    if(!Array.isArray(row.events))invalid('genai_metadata_invalid')
    for(const event of row.events as Record<string,unknown>[]){
     if(event.name!=='exception'&&event.name!=='porthole.gen_ai.retry')invalid('genai_content_not_authorized')
     for(const attr of Array.isArray(event.attributes)?event.attributes as Record<string,unknown>[]:[])if(!['exception.type','porthole.gen_ai.attempt'].includes(String(attr.key)))invalid('genai_content_not_authorized')
    }
   }
   for(const attr of attrs)if(typeof attr.key!=='string'||!metadata.has(attr.key)&&!['error.type','server.address','server.port',...(row.name==='exception'?['exception.type']:[])].includes(attr.key))invalid('genai_content_not_authorized')
  }
  for(const [key,entry]of Object.entries(row)){
   if(protectedKey(key)||marked&&contentKey(key))invalid('genai_content_not_authorized')
   // Resource attributes have their own ordinary scope semantics. Span and log
   // attributes and event bodies inherit the marked record's content boundary.
   walk(entry,marked&&['attributes','events','body'].includes(key))
  }
 }
 walk(value)
}
