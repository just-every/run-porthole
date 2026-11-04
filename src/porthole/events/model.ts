import {fail,type Scope} from '../security/authority'
import {scopeLabel,timestamp,label} from '../dashboards/model'
import {canonical} from '../ingest/model'
import {digest} from '../audit/store'
export const eventColumns=['sequence','id','source','source_id','service','environment','team','occurred_ns','received_at','body','digest','actor_ref','actor_revision','state']
export const filterColumns=['id','owner_ref','name','definition','revision','state','created_at']
export interface CustomEvent {sourceType:'custom';source:string;sourceId:string;title:string;text:string;service:string;environment:string;team:string;resource:string;tags:string[];severity:'info'|'warning'|'error';occurredAt:string;correlationKey:string}
export interface EventRow {sequence:number;id:string;source:string;source_id:string;service:string;environment:string;team:string;occurred_ns:string;received_at:number;body:string;digest:string;actor_ref:string;actor_revision:number;state:'active'|'quarantined'}
export interface FilterRow {id:string;owner_ref:string;name:string;definition:string;revision:number;state:string;created_at:number}
export type EventFilter=Partial<Record<'source'|'sourceId'|'service'|'environment'|'team'|'severity'|'resource'|'tag'|'text'|'correlationKey'|'from'|'through',string>>
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('invalid_event',400)
const optional=(v:unknown,max:number)=>v===undefined||v===''?'':label(v,max)
export function customEvent(raw:unknown):CustomEvent {
 const v=object(raw)
 if(Object.keys(v).some(k=>!['sourceType','source','sourceId','title','text','service','environment','team','resource','tags','severity','occurredAt','correlationKey'].includes(k))||v.sourceType!==undefined&&v.sourceType!=='custom')fail('custom_event_only',400)
 const tags=v.tags??[]
 if(!Array.isArray(tags)||tags.length>30||tags.some(t=>typeof t!=='string'||t.length<1||t.length>120)||new Set(tags).size!==tags.length)fail('invalid_event_tags',400)
 if(!['info','warning','error'].includes(String(v.severity)))fail('invalid_event_severity',400)
 return {sourceType:'custom',source:scopeLabel(v.source),sourceId:label(v.sourceId),title:label(v.title,200),text:optional(v.text,3000),service:scopeLabel(v.service),environment:scopeLabel(v.environment),team:scopeLabel(v.team),resource:optional(v.resource,200),tags:[...tags].sort(),severity:v.severity as CustomEvent['severity'],occurredAt:timestamp(v.occurredAt).padStart(20,'0'),correlationKey:optional(v.correlationKey,200)}
}
export function eventScope(v:{service:string;environment:string;team:string}):Scope {return {services:[v.service],environments:[v.environment],teams:[v.team]}}
export function eventFilter(raw:unknown):EventFilter {
 const v=object(raw),out:EventFilter={}
 for(const [k,value]of Object.entries(v)) {
  if(!['source','sourceId','service','environment','team','severity','resource','tag','text','correlationKey','from','through'].includes(k))fail('invalid_event_filter',400)
  if(value==='')continue
  const key=k as keyof EventFilter
  out[key]=['from','through'].includes(k)?timestamp(value).padStart(20,'0'):['source','service','environment','team'].includes(k)?scopeLabel(value):label(value,k==='text'?300:k==='tag'?120:200)
 }
 if(out.severity&&!['info','warning','error'].includes(out.severity)||out.from&&out.through&&BigInt(out.from)>BigInt(out.through))fail('invalid_event_filter',400)
 return out
}
export const eventDigest=(v:CustomEvent)=>digest(canonical(v))
export function representation(row:EventRow) {return {id:row.id,...customEvent(JSON.parse(row.body)),receivedAt:row.received_at,provenance:{kind:'native-custom',actorRef:row.actor_ref,actorRevision:row.actor_revision,digest:row.digest},state:row.state}}
export async function validateEventRow(row:Record<string,unknown>) {
 const v=customEvent(JSON.parse(String(row.body)))
 if(row.source!==v.source||row.source_id!==v.sourceId||row.service!==v.service||row.environment!==v.environment||row.team!==v.team||row.occurred_ns!==v.occurredAt||await eventDigest(v)!==row.digest||!Number.isSafeInteger(row.sequence)||Number(row.sequence)<1||!Number.isSafeInteger(row.received_at)||!Number.isSafeInteger(row.actor_revision)||Number(row.actor_revision)<1||!['active','quarantined'].includes(String(row.state))||![row.id,row.actor_ref].every(x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x)))fail('archive_semantics_invalid',422)
}

export const facetFields=['source','service','environment','team','severity','resource','tag'] as const
export type FacetField=typeof facetFields[number]
/** Facets cover the complete matching receipt snapshot, before page position. */
export function eventFacets(rows:{field:FacetField;value:string;count:number}[],total:number) {
 const counts=Object.fromEntries(facetFields.map(field=>[field,rows.filter(row=>row.field===field).map(({value,count})=>({value,count}))])) as Record<FacetField,{value:string;count:number}[]>
 return {scope:'snapshot' as const,totalEvents:total,counts}
}
