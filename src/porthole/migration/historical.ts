import {observationTime} from './observation-page'
import type {Bindings} from '../../auth.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {fail} from '../security/authority'
import {migrationOwner} from './authority'
import {readSplunkHistory,splunkTimestampNs,type SplunkMetricHistory} from './splunk/history'
import type {CompiledSignalFlow} from './splunk/signalflow/compile'
import type {NativeSample} from './splunk/signalflow/evaluate'
export type MigrationRecord={kind:string;id:string;body:string;revision:string}
export async function sourceRecord(env:Bindings,predicate:D1Sql,id:string,kinds:string[],revision?:string){
 const result=await env.DB.prepare(`SELECT kind,id,body,revision FROM porthole_migration_records WHERE id=? AND (${predicate.sql})`).bind(id,...predicate.params??[]).first<MigrationRecord>()
 if(!result||!kinds.includes(result.kind))fail('source_record_not_found',404)
 if(revision!==undefined&&result.revision!==revision)fail('source_replay_stale',409)
 return result
}
export async function fenceSourceRecords(request:Request,env:Bindings,records:MigrationRecord[]){
 const predicate=await migrationOwner(request,env)
 const matches=records.map(()=>'(SELECT count(*) FROM porthole_migration_records WHERE kind=? AND id=? AND body=? AND revision=?)=1').join(' AND ')
 const live=await env.DB.prepare(`SELECT 1 AS live WHERE (${predicate.sql}) AND ${matches}`).bind(...predicate.params??[],...records.flatMap(row=>[row.kind,row.id,row.body,row.revision])).first()
 if(!live)fail('source_replay_stale',409)
}
export function sourceHistory(row:MigrationRecord):SplunkMetricHistory{
 const value=JSON.parse(row.body)
 if(value.vendor!=='splunk')fail('source_history_required',422)
 const read=readSplunkHistory(value.definition)
 if(!read.ok)fail('source_history_incomplete',422)
 return read.history
}
export function historicalSamples(history:SplunkMetricHistory,program:CompiledSignalFlow,scope:Record<string,string>,range:{from:string;through:string}){
 if(program.resolutionMs&&program.resolutionMs!==history.request.resolution)fail('source_history_resolution_mismatch',422)
 const samples:NativeSample[]=[],series:Record<string,unknown>[]=[]
 for(const [id,metadata]of Object.entries(history.metadata)){
  if(metadata.metric!==program.metric)continue
  if(metadata.type!=='GAUGE')fail('source_history_gauge_required',422)
  for(const key of ['service','environment','team'])if(metadata.dimensions[key]!==scope[key])fail('source_history_scope_unmapped',422)
  if(program.filter&&metadata.dimensions[program.filter.property]!==program.filter.value)continue
  const points=history.response.data[id].filter(([time])=>{const ns=BigInt(splunkTimestampNs(time));return ns>=BigInt(range.from)&&ns<=BigInt(range.through)})
  series.push({id,metadata,selectedPoints:points.length})
  const attrs=Object.entries(metadata.dimensions).map(([key,value])=>({key,value:{stringValue:value}}))
  // This is a read projection of retained source data, never a new intake batch.
  for(const [time,value]of points)samples.push({event_time_ns:splunkTimestampNs(time),payload:{resource:{attributes:attrs},scope:{name:'splunk-imported-history',seriesId:id},metricKind:'gauge',metric:{name:metadata.metric},record:{asDouble:value}}})
 }
 if(!series.length)fail('source_history_metric_unavailable',422)
 return {records:samples,sourceSeries:series,sourceLimitations:history.limitations}
}
export async function historicalResponse(request:Request,env:Bindings,predicate:D1Sql,html:boolean){
 const id=new URL(request.url).searchParams.get('id')??'',row=await sourceRecord(env,predicate,id,['history']),history=sourceHistory(row)
 await fenceSourceRecords(request,env,[row])
 const series=Object.entries(history.metadata).map(([id,metadata])=>({id,metadata,points:history.response.data[id].map(([milliseconds,value])=>({timeUnixNano:splunkTimestampNs(milliseconds),sourceTimestampMs:milliseconds,value}))}))
 const result={source:'imported-splunk-history',sourceId:history.id,revision:row.revision,request:history.request,series,limitations:history.limitations,qualification:'Retained source rollups. No full-resolution, complete-account-history or equivalent-cutover claim.'}
 if(!html)return Response.json(result,{headers:privateHeaders})
 return document('Imported metric history',`<p><a href="/app/import">Return to Move in</a></p><p>${escape(result.qualification)}</p><p>Selected source window: ${escape(new Date(history.request.startMs).toISOString())} through ${escape(new Date(history.request.endMS).toISOString())}; resolution ${history.request.resolution} ms. Original source milliseconds and exact converted nanoseconds remain available.</p>${series.length?series.map(item=>`<section><h2>${escape(item.metadata.metric)} · ${escape(item.id)}</h2><p>${escape(item.metadata.type)} · ${item.points.length} retained source points</p><details><summary>Source dimensions and tags</summary><pre>${escape(JSON.stringify(item.metadata,null,2))}</pre></details><table class="porthole-observation-table"><thead><tr><th>Time (UTC)</th><th>Value</th></tr></thead><tbody>${item.points.map(point=>`<tr><td>${escape(observationTime(point.timeUnixNano))}</td><td>${point.value}</td></tr>`).join('')}</tbody></table><details><summary>Exact source timestamps</summary><pre>${escape(JSON.stringify(item.points,null,2))}</pre></details></section>`).join(''):'<p>No source samples in this selected export. Missing history remains unknown.</p>'}<h2>Source limits</h2><ul>${history.limitations.map(limit=>`<li>${escape(limit)}</li>`).join('')}</ul>`)
}
