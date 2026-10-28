import {fail,parseScope,scopeWithin,type Scope} from '../security/authority'
import {timestamp,scopeLabel} from '../dashboards/model'
import {normalizeExploration} from '../explore/normalize'
import {uuid} from '../portability/format-id'

export interface Snapshot {watermark:number;recordIds:string[];queryRefs:string[];capturedAt:number}
export interface TextCell {id:string;kind:'text';text:string}
export interface QueryCell {id:string;kind:'query'|'chart';title:string;query:Record<string,string>;snapshot:Snapshot}
export type Cell=TextCell|QueryCell
export interface Comment {id:string;text:string;authorRef:string;createdAt:number;mentions:{memberRef:string;status:'undelivered'}[]}
export interface Notebook {origin:{monitorId:string;revision:number;evaluationId:string};cells:Cell[];comments:Comment[]}
export interface NotebookRow {id:string;name:string;owner_ref:string;author_ref:string;scope:string;body:string;revision:number;state:'active'|'quarantined';created_at:number;updated_at:number}
export const columns=['id','name','owner_ref','author_ref','scope','body','revision','state','created_at','updated_at']
export const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:fail('invalid_notebook',400)
export const label=(value:unknown,max=120):string=>typeof value==='string'&&value.trim().length>0&&value.length<=max?value:fail('invalid_notebook_text',400)
export const integer=(value:unknown,min=0):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=min
const id=(value:unknown)=>uuid(value)?value:fail('invalid_notebook_reference',400)
export function queryInput(value:unknown):Record<string,string> {
 const raw=object(value),allowed=['signal','service','environment','team','from','through','dialect','expression','metric','trace']
 if(Object.keys(raw).some(key=>!allowed.includes(key)||typeof raw[key]!=='string'))fail('invalid_notebook_query',400)
 if(!['logs','metrics','traces'].includes(String(raw.signal)))fail('invalid_notebook_signal',400)
 for(const key of ['service','environment','team'])scopeLabel(raw[key])
 const from=timestamp(raw.from),through=timestamp(raw.through)
 if(BigInt(from)>BigInt(through))fail('invalid_notebook_range',400)
 normalizeExploration(raw)
 return {...raw,from,through} as Record<string,string>
}
export function notebookBody(value:unknown):Notebook {
 const raw=object(value),origin=object(raw.origin)
 if(Object.keys(raw).sort().join(',')!=='cells,comments,origin'||Object.keys(origin).sort().join(',')!=='evaluationId,monitorId,revision'||!integer(origin.revision,1)||!Array.isArray(raw.cells)||raw.cells.length>30||!Array.isArray(raw.comments)||raw.comments.length>100)fail('invalid_notebook',400)
 const ids=new Set<string>()
 const cells:Cell[]=raw.cells.map(value=>{
  const cell=object(value),cellId=label(cell.id,80)
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(cellId)||ids.has(cellId))fail('invalid_notebook_cell',400)
  ids.add(cellId)
  if(cell.kind==='text') {
   if(Object.keys(cell).sort().join(',')!=='id,kind,text')fail('invalid_notebook_cell',400)
   return {id:cellId,kind:'text',text:label(cell.text,5000)}
  }
  if(!['query','chart'].includes(String(cell.kind))||Object.keys(cell).sort().join(',')!=='id,kind,query,snapshot,title')fail('invalid_notebook_cell',400)
  const snapshot=object(cell.snapshot)
  if(Object.keys(snapshot).sort().join(',')!=='capturedAt,queryRefs,recordIds,watermark'||!integer(snapshot.watermark)||!integer(snapshot.capturedAt)||!Array.isArray(snapshot.recordIds)||snapshot.recordIds.length>2000||new Set(snapshot.recordIds).size!==snapshot.recordIds.length||snapshot.recordIds.some(ref=>typeof ref!=='string'||!/^[a-f0-9-]{36}:\d+$/.test(ref))||!Array.isArray(snapshot.queryRefs)||!snapshot.queryRefs.length||snapshot.queryRefs.length>10||snapshot.queryRefs.some(ref=>!uuid(ref)))fail('invalid_notebook_snapshot',400)
  return {id:cellId,kind:cell.kind as 'query'|'chart',title:label(cell.title),query:queryInput(cell.query),snapshot:snapshot as unknown as Snapshot}
 })
 const comments=raw.comments.map(value=>{
  const c=object(value)
  if(Object.keys(c).sort().join(',')!=='authorRef,createdAt,id,mentions,text'||!integer(c.createdAt)||!Array.isArray(c.mentions)||c.mentions.length>20)fail('invalid_notebook_comment',400)
  return {id:id(c.id),text:label(c.text,2000),authorRef:id(c.authorRef),createdAt:c.createdAt,mentions:c.mentions.map(value=>{
   const m=object(value);if(Object.keys(m).sort().join(',')!=='memberRef,status'||m.status!=='undelivered')fail('invalid_notebook_mention',400)
   return {memberRef:id(m.memberRef),status:'undelivered' as const}
  })}
 })
 return {origin:{monitorId:id(origin.monitorId),revision:origin.revision,evaluationId:id(origin.evaluationId)},cells,comments}
}
export function cellScope(cell:QueryCell):Scope {return {services:[cell.query.service],environments:[cell.query.environment],teams:[cell.query.team]}}
export function notebookRow(value:Record<string,unknown>) {
 if(Object.keys(value).sort().join(',')!==[...columns].sort().join(',')||!uuid(value.id)||!uuid(value.owner_ref)||!uuid(value.author_ref)||!integer(value.revision,1)||!integer(value.created_at)||!integer(value.updated_at)||!['active','quarantined'].includes(String(value.state)))fail('invalid_notebook',400)
 label(value.name);const scope=parseScope(JSON.parse(String(value.scope))),body=notebookBody(JSON.parse(String(value.body)))
 if(body.cells.some(cell=>cell.kind!=='text'&&!scopeWithin(cellScope(cell),scope)))fail('invalid_notebook_scope',400)
}
