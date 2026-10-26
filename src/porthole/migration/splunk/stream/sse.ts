import {identity,object,type StreamMessage} from './types'
/** Finite original SSE bytes, including comments, stay in capture.body. No reconnect or replay inference. */
export function readSse(body:string):StreamMessage[]{
 const normalized=body.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
 if(!body||!normalized.endsWith('\n\n'))throw Error('Incomplete SSE capture: final event needs its terminating blank line')
 const messages:StreamMessage[]=[],ids=new Set<string>()
 let event:string|undefined,id:string|undefined,lines:string[]=[],fields=new Set<string>()
 const flush=()=>{
  if(!fields.size)return
  if(!event||!lines.length)throw Error('Malformed SSE record: explicit event and JSON data are required')
  if(id!==undefined){if(!identity(id)||ids.has(id))throw Error('Duplicate or malformed SSE event id');ids.add(id)}
  let data:unknown
  try{data=JSON.parse(lines.join('\n'))}catch{throw Error('Malformed SSE JSON data')}
  if(!object(data))throw Error('SSE data must be a JSON object')
  messages.push({event,...(id!==undefined?{id}:{}),data});event=undefined;id=undefined;lines=[];fields=new Set()
 }
 for(const line of normalized.split('\n')){
  if(!line){flush();continue}
  if(line.startsWith(':'))continue
  const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon)
  let value=colon<0?'':line.slice(colon+1);if(value.startsWith(' '))value=value.slice(1)
  if(!['event','id','data','retry'].includes(field))throw Error('Unknown SSE field: '+field)
  if(field!=='data'&&fields.has(field))throw Error('Duplicate SSE field: '+field)
  fields.add(field)
  if(field==='event')event=value
  else if(field==='id')id=value
  else if(field==='data')lines.push(value)
  else if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value)))throw Error('Malformed SSE retry field')
 }
 if(!messages.length)throw Error('Empty SSE capture')
 return messages
}
