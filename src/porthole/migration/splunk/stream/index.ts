import {assertNoCredentials} from '../../../../modules/import-kit/src/provenance/credentials.ts'
import {canonicalJson} from '../../../../modules/import-kit/src/provenance/identity.ts'
import {dimensions,identity,object,strings,timestamp,type SourceStream} from './types'
import {readSse} from './sse'
import {validateMessages} from './messages'
export type {SourceStream,StreamDefinition} from './types'
export {compareSourceStream} from './compare'
/** Read an owner-supplied official finite SSE capture; this never executes a source request. */
export function readSourceStream(value:unknown):{ok:true;stream:SourceStream}|{ok:false;reason:string}{
 try{
  if(!object(value)||value.source!=='splunk-signalflow-stream'||!identity(value.id)||typeof value.programText!=='string'||!value.programText.trim()||value.programText.length>16384)throw Error('Source stream needs a stable id, supported source and exact programText')
  canonicalJson(value)
  const {request,capture,comparison}=value
  if(!object(request)||!timestamp(request.startMs)||!timestamp(request.stopMs)||request.stopMs<=request.startMs||!Number.isSafeInteger(request.resolution)||Number(request.resolution)<=0||Object.keys(request).some(key=>!['startMs','stopMs','resolution'].includes(key)))throw Error('Source stream needs an explicit finite millisecond request range and requested resolution')
  if(!object(capture)||capture.transport!=='sse'||typeof capture.body!=='string'||new TextEncoder().encode(capture.body).length>60000||Object.keys(capture).some(key=>!['transport','body'].includes(key)))throw Error('Source capture needs the original bounded SSE body and transport')
  if(!object(comparison)||!identity(comparison.valueTsId)||comparison.eventTsId!==undefined&&!identity(comparison.eventTsId)||typeof comparison.label!=='string'||!comparison.label||!dimensions(comparison.dimensions)||!strings(comparison.tags)||comparison.inputVariable!==undefined&&(typeof comparison.inputVariable!=='string'||!/^[A-Za-z_]\w*$/.test(comparison.inputVariable))||Object.keys(comparison).some(key=>!['valueTsId','eventTsId','label','dimensions','tags','inputVariable'].includes(key)))throw Error('Source comparison needs declared series identity, publish label, dimensions and tags')
  if(Object.keys(value).some(key=>!['id','source','programText','request','capture','comparison'].includes(key)))throw Error('Unknown source capture envelope field')
  const messages=readSse(capture.body)
  assertNoCredentials(messages)
  const parsed=validateMessages(messages)
  for(const id of [comparison.valueTsId,...(comparison.eventTsId?[comparison.eventTsId]:[])])if(!Object.hasOwn(parsed.metadata,id))throw Error('Declared comparison tsId is missing from source metadata')
  for(const record of [...parsed.data,...parsed.events]){
   const time=Number(record.data.logicalTimestampMs??record.data.timestampMs)
   if(time<request.startMs||time>request.stopMs)throw Error('Source values or transitions fall outside the declared request range')
  }
  return {ok:true,stream:{...value as unknown as SourceStream,messages,...parsed}}
 }catch(error){return {ok:false,reason:error instanceof Error?error.message:'Malformed source stream'}}
}
