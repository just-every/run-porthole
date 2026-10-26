import type {Bindings} from '../../auth.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {input,text} from '../security/input'
import {fail} from '../security/authority'
import {readTelemetry} from '../ingest/read'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {compileSignalFlow,SignalFlowUnsupported} from './splunk/signalflow/compile'
import {replaySamples} from './splunk/signalflow/evaluate'
export async function migrationReplay(request:Request,env:Bindings,predicate:D1Sql,page:boolean){
 const data=await input(request)
 if(Object.keys(data).some(key=>!['targetId','service','environment','team','from','through'].includes(key)))fail('invalid_replay_input',400)
 const targetId=text(data.targetId,500)
 const guard=()=>env.DB.prepare(`SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE json('OWNER_REQUIRED') END`).bind(...predicate.params??[])
 const held=await env.DB.batch<{body:string}>([guard(),env.DB.prepare("SELECT body FROM porthole_migration_records WHERE id=? AND kind IN ('charts','detectors')").bind(targetId),guard()])
 if(!held[1].results.length)fail('source_record_not_found',404)
 const source=JSON.parse(held[1].results[0].body)
 if(source.vendor!=='splunk'||typeof source.definition.programText!=='string')fail('source_program_required',400)
 let program
 try{program=compileSignalFlow(source.definition.programText)}catch(error){
  if(!(error instanceof SignalFlowUnsupported))throw error
  const result={error:'unqualified_signalflow',offset:error.offset,construct:error.construct,qualification:'Resolve this source construct before native replay'}
  return page?document('Replay unavailable',`<p role="alert">${escape(error.message)}</p><p><a href="/app/import">Return to Move in</a></p>`,422):Response.json(result,{status:422,headers:privateHeaders})
 }
 const url=new URL('/api/porthole/v1/ingest/records',request.url)
 url.searchParams.set('signal','metrics');url.searchParams.set('metric',program.metric);url.searchParams.set('limit','200')
 for(const key of ['service','environment','team']){
  const value=text(data[key]);if(program.filter?.property===key&&program.filter.value!==value)fail('source_filter_scope_mismatch',422)
  url.searchParams.set(key,value)
 }
 for(const key of ['from','through']){if(typeof data[key]!=='string'||!/^\d{1,20}$/.test(data[key]))fail('replay_range_required',400);url.searchParams.set(key,data[key] as string)}
 const headers=new Headers(request.headers);headers.delete('authorization')
 const response=await readTelemetry(new Request(url,{headers}),env)
 if(!response.ok)return response
 const retained=await response.json() as {records:Parameters<typeof replaySamples>[1];cursor:string|null;queryRef:string;snapshot:number}
 if(retained.cursor)fail('replay_window_incomplete_narrow_range',422)
 let result
 try{result={...replaySamples(program,retained.records),program,sourceId:source.definition.id,sourceText:source.definition.programText,queryRef:retained.queryRef,snapshot:retained.snapshot,notifications:'inactive'}}catch(error){
  const detail=error instanceof Error?error.message:'Unqualified samples'
  return page?document('Replay unavailable',`<p role="alert">${escape(detail)}</p><p><a href="/app/import">Return to Move in</a></p>`,422):Response.json({error:'unqualified_replay_samples',detail},{status:422,headers:privateHeaders})
 }
 return page?document('Retained sample replay',`<p>${escape(result.qualification)}</p><p>No monitor is activated and no notification is sent. Empty windows have no inferred healthy state.</p><pre>${escape(JSON.stringify(result,null,2))}</pre><p><a href="/app/import">Return to Move in</a></p>`):Response.json(result,{headers:privateHeaders})
}
export function replayForm(records:{targetId:string;value:{definition:{name?:string;id:string}}}[]){
 if(!records.length)return ''
 return `<details><summary>Analyze retained metric samples</summary><p>Limited SignalFlow grammar: one data stream, optional literal scope filter, cross-series mean, sum, min or max, and one immediate comparison. Source timing and lifecycle parity remain unqualified.</p><form method="post" action="/app/import/replay"><label>Source definition<select name="targetId">${records.map(r=>`<option value="${escape(r.targetId)}">${escape(r.value.definition.name??r.value.definition.id)}</option>`).join('')}</select></label>${['service','environment','team','from','through'].map(key=>`<label>${key==='from'?'From in nanoseconds':key==='through'?'Through in nanoseconds':key}<input name="${key}" required></label>`).join('')}<button>Analyze retained samples</button></form></details>`
}
