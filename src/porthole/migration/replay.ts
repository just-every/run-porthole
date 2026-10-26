import type {Bindings} from '../../auth.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {input,text} from '../security/input'
import {fail} from '../security/authority'
import {readTelemetry} from '../ingest/read'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {compileSignalFlow,SignalFlowUnsupported} from './splunk/signalflow/compile'
import {replaySamples} from './splunk/signalflow/evaluate'
import {comparisonContext} from './source-comparison'
import {readSourceStream,compareSourceStream} from './splunk/stream/index'
import {replayBody} from './observation-page'
import {sourceRecord,fenceSourceRecords,sourceHistory,historicalSamples} from './historical'
export async function migrationReplay(request:Request,env:Bindings,predicate:D1Sql,page:boolean){
 const data=await input(request)
 if(page&&typeof data.targetRef==='string'){let ref:unknown;try{ref=JSON.parse(data.targetRef)}catch{fail('invalid_source_reference',400)}if(!Array.isArray(ref)||ref.length!==2||ref.some(value=>typeof value!=='string'))fail('invalid_source_reference',400);data.targetId=ref[0];data.targetRevision=ref[1];delete data.targetRef}
 if(Object.keys(data).some(key=>!['targetId','targetRevision','historyId','sourceStreamId','service','environment','team','from','through'].includes(key)))fail('invalid_replay_input',400)
 const targetId=text(data.targetId,500)
 const revision=text(data.targetRevision,100)
 const row=await sourceRecord(env,predicate,targetId,['charts','detectors'],revision),source=JSON.parse(row.body)
 if(source.vendor!=='splunk'||typeof source.definition.programText!=='string')fail('source_program_required',400)
 let program
 try{program=compileSignalFlow(source.definition.programText)}catch(error){
  if(!(error instanceof SignalFlowUnsupported))throw error
  await fenceSourceRecords(request,env,[row])
  const result={error:'unqualified_signalflow',offset:error.offset,construct:error.construct,qualification:'Resolve this source construct before native replay'}
  return page?document('Replay unavailable',`<p role="alert">${escape(error.message)}</p><p><a href="/app/import">Return to Move in</a></p>`,422):Response.json(result,{status:422,headers:privateHeaders})
 }
 const url=new URL('/api/porthole/v1/ingest/records',request.url)
 url.searchParams.set('signal','metrics');url.searchParams.set('metric',program.metric);url.searchParams.set('limit','200')
 for(const key of ['service','environment','team']){
  const value=text(data[key]);if(program.filter?.property===key&&program.filter.value!==value)fail('source_filter_scope_mismatch',422)
  url.searchParams.set(key,value)
 }
 if(program.filter&&!['service','environment','team'].includes(program.filter.property))fail('source_filter_scope_mismatch',422)
 for(const key of ['from','through']){if(typeof data[key]!=='string'||!/^\d{1,20}$/.test(data[key]))fail('replay_range_required',400);url.searchParams.set(key,data[key] as string)}
 const range={from:String(data.from),through:String(data.through)}
 if(BigInt(range.from)>18446744073709551615n||BigInt(range.through)>18446744073709551615n||BigInt(range.through)<BigInt(range.from))fail('invalid_query_range',400)
 let retained,historyRow,streamRow
 if(typeof data.historyId==='string'&&data.historyId){
  historyRow=await sourceRecord(env,predicate,text(data.historyId,500),['history'])
  retained={...historicalSamples(sourceHistory(historyRow),program,{service:String(data.service),environment:String(data.environment),team:String(data.team)},range),cursor:null,queryRef:null,snapshot:null}
 }else{
  const headers=new Headers(request.headers);headers.delete('authorization')
  const response=await readTelemetry(new Request(url,{headers}),env)
  if(!response.ok)return response
  retained=await response.json() as {records:Parameters<typeof replaySamples>[1];cursor:string|null;queryRef:string;snapshot:number}
  if(retained.cursor)fail('replay_window_incomplete_narrow_range',422)
 }
 let result:ReturnType<typeof replaySamples>&{sourceText:string;sourceRevision:string;[key:string]:unknown}
 try{result={...replaySamples(program,retained.records,range),program,sourceId:source.definition.id,sourceText:source.definition.programText,sourceTags:source.definition.tags??null,queryRef:retained.queryRef,snapshot:retained.snapshot,sourceRevision:row.revision,...(historyRow?{historyId:historyRow.id,historyRevision:historyRow.revision,sourceSeries:'sourceSeries' in retained?retained.sourceSeries:[],sourceLimitations:'sourceLimitations' in retained?retained.sourceLimitations:[]}:{}),notifications:'inactive'}}catch(error){
  await fenceSourceRecords(request,env,[row,...(historyRow?[historyRow]:[])])
  const detail=error instanceof Error?error.message:'Unqualified samples'
  return page?document('Replay unavailable',`<p role="alert">${escape(detail)}</p><p><a href="/app/import">Return to Move in</a></p>`,422):Response.json({error:'unqualified_replay_samples',detail},{status:422,headers:privateHeaders})
 }
 if(typeof data.sourceStreamId==='string'&&data.sourceStreamId){
  streamRow=await sourceRecord(env,predicate,text(data.sourceStreamId,500),['sourceStreams'])
  const capture=readSourceStream(JSON.parse(streamRow.body).definition)
  if(!capture.ok)fail('source_stream_incomplete',422)
  const context=comparisonContext(retained.records,'sourceSeries' in retained?retained.sourceSeries as {metadata:Record<string,unknown>}[]:undefined)
  Object.assign(result,{sourceComparison:compareSourceStream(capture.stream,{...result,...context},range),sourceStreamRevision:streamRow.revision,sourceEvents:capture.stream.events})
 }
 await fenceSourceRecords(request,env,[row,...(historyRow?[historyRow]:[]),...(streamRow?[streamRow]:[])])
 return page?document('Retained sample replay',replayBody(result)):Response.json(result,{headers:privateHeaders})
}
export function replayForm(records:{targetId:string;revision:string;value:{definition:{name?:string;id:string}}}[],history:{targetId:string;value:{definition:{id:string}}}[]=[],streams:{targetId:string;value:{definition:{id:string}}}[]=[]){
 if(!records.length)return ''
 return `<details><summary>Analyze retained metric samples</summary><p>Choose native observations or imported source rollups. The finite replay supports one gauge stream, literal scope filter, cross-series mean, sum, min or max, and comparisons. Explicit resolution also permits trailing windows and lasting with a separate clear condition. Missing intervals and warm-up stay Unknown; source cadence and full lifecycle parity remain unqualified.</p><form method="post" action="/app/import/replay"><label>Source definition<select name="targetRef">${records.map(r=>`<option value="${escape(JSON.stringify([r.targetId,r.revision]))}">${escape(r.value.definition.name??r.value.definition.id)}</option>`).join('')}</select></label><label>Sample source<select name="historyId"><option value="">Native intake observations</option>${history.map(h=>`<option value="${escape(h.targetId)}">Imported source · ${escape(h.value.definition.id)}</option>`).join('')}</select></label><label>Source stream comparison<select name="sourceStreamId"><option value="">No source capture comparison</option>${streams.map(stream=>`<option value="${escape(stream.targetId)}">${escape(stream.value.definition.id)}</option>`).join('')}</select></label>${['service','environment','team','from','through'].map(key=>`<label>${key==='from'?'From in nanoseconds':key==='through'?'Through in nanoseconds':key}<input name="${key}" required></label>`).join('')}<button>Analyze retained samples</button></form></details>`
}
