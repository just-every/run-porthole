import type {Bindings} from '../../../../auth.server'
import {readTelemetry} from '../../../ingest/read'
import {fail} from '../../../security/authority'
import type {IndexMapping,NativeLog} from './mapping'
type Page={snapshot:number;queryRef:string;cursor:string|null;records:NativeLog[]}
/** Page only immutable native observations at one server-selected watermark. */
export async function readMappedLogs(request:Request,env:Bindings,mapping:IndexMapping,range:{from:string;through:string}){
 const url=new URL('/api/porthole/v1/ingest/records',request.url),headers=new Headers(request.headers)
 headers.delete('authorization')
 for(const [key,value]of Object.entries({...mapping,...range,signal:'logs',limit:'200'}))if(key!=='index')url.searchParams.set(key,value)
 const records:NativeLog[]=[],queryRefs:string[]=[],ids=new Set<string>(),cursors=new Set<string>()
 let snapshot:number|undefined
 for(let pageNumber=0;pageNumber<20;pageNumber++){
  const response=await readTelemetry(new Request(url,{headers}),env)
  if(!response.ok)return {response}
  const page=await response.json() as Page
  if(!Number.isSafeInteger(page.snapshot)||page.snapshot<0||snapshot!==undefined&&page.snapshot!==snapshot||!Array.isArray(page.records)||page.records.length>200||typeof page.queryRef!=='string'||page.cursor!==null&&typeof page.cursor!=='string')fail('spl_native_read_incomplete',422)
  snapshot=page.snapshot;queryRefs.push(page.queryRef)
  for(const row of page.records){
   if(typeof row.id!=='string'||ids.has(row.id)||typeof row.event_time_ns!=='string'||!/^\d{1,20}$/.test(row.event_time_ns)||BigInt(row.event_time_ns)<BigInt(range.from)||BigInt(row.event_time_ns)>BigInt(range.through))fail('spl_native_read_incomplete',422)
   ids.add(row.id);records.push(row)
  }
  if(page.cursor===null)return {records,queryRefs,snapshot}
  if(!page.records.length||cursors.has(page.cursor))fail('spl_native_read_incomplete',422)
  cursors.add(page.cursor);url.searchParams.set('cursor',page.cursor);url.searchParams.set('snapshot',String(snapshot))
 }
 fail('spl_native_window_incomplete_narrow_range',422)
}
