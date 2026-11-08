import { canonical } from '../ingest/model'
import { fail } from '../security/authority'
import type { TraceRecord } from '../traces/graph'
import {associations,mergeAssociations,type Association} from './associations'

export const metadataColumns=['id','service','environment','team','revision','owner_ref','repository','runbook','criticality','author_ref','created_at','state']
export interface Metadata {
 id:string;service:string;environment:string;team:string;revision:number;owner_ref:string|null
 repository:string;runbook:string;criticality:string;author_ref:string;created_at:number;state:string
}
export function safeLink(value:unknown):string {
 if(typeof value!=='string'||value.length>1000)fail('invalid_service_link',400)
 if(!value)return ''
 let url:URL;try{url=new URL(value)}catch{return fail('invalid_service_link',400)}
 if(url.protocol!=='https:'||url.username||url.password||/[\u0000-\u0020\u007f]/.test(value))fail('invalid_service_link',400)
 return url.href
}
export function validateMetadata(row:Record<string,unknown>) {
 for(const key of ['service','environment','team'])if(typeof row[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/.test(String(row[key])))fail('invalid_service_metadata',422)
 for(const key of ['id','author_ref'])if(typeof row[key]!=='string'||!(key==='id'?/^[a-f0-9]{32}$/:/^[a-f0-9-]{36}$/).test(String(row[key])))fail('invalid_service_metadata',422)
 if(row.owner_ref!==null&&(typeof row.owner_ref!=='string'||!/^[a-f0-9-]{36}$/.test(row.owner_ref)))fail('invalid_service_metadata',422)
 if(!Number.isSafeInteger(row.revision)||Number(row.revision)<1||!Number.isSafeInteger(row.created_at)||Number(row.created_at)<0||!['active','quarantined'].includes(String(row.state))||!['unclassified','low','medium','high','critical'].includes(String(row.criticality)))fail('invalid_service_metadata',422)
 safeLink(row.repository);safeLink(row.runbook)
}
export function attributes(value:unknown):Record<string,unknown> {
 if(!value||typeof value!=='object')return {}
 const list=(value as {attributes?:unknown}).attributes
 if(!Array.isArray(list))return {}
 return Object.fromEntries(list.filter(v=>v&&typeof v.key==='string'&&v.value&&typeof v.value==='object').map(v=>[v.key,v.value.stringValue??v.value.intValue??v.value.doubleValue??v.value.boolValue]))
}
const identity=(row:{service:string;environment:string;team:string})=>canonical([row.service,row.environment,row.team])
export function catalog(records:TraceRecord[],from:string,through:string,truncated:boolean,now:number) {
 const services=new Map<string,{service:string;environment:string;team:string;versions:Set<string>;lastSeenNs:bigint;spanCount:number;requests:{duration:bigint;error:boolean;endpoint:string}[];associations:Association[]}>()
 const variants=new Map<string,Map<string,TraceRecord>>()
 for(const row of records){
  const key=row.trace_id+':'+row.span_id,group=variants.get(key)??new Map<string,TraceRecord>()
  group.set(canonical({service:row.service,environment:row.environment,team:row.team,record:row.payload.record,resource:row.payload.resource??{},scope:row.payload.scope??{}}),row);variants.set(key,group)
 }
 const unique=new Map([...variants].filter(([,v])=>v.size===1).map(([k,v])=>[k,[...v.values()][0]]))
 const parentsWithChildren=new Set([...unique.values()].flatMap(row=>typeof row.payload.record.parentSpanId==='string'&&row.payload.record.parentSpanId?[row.trace_id+':'+row.payload.record.parentSpanId.toLowerCase()]:[]))
 const edges=new Map<string,{from:string;to:string|null;kind:string;observations:number}>()
 let conflicts=0
 for(const [key,group]of variants){
  if(group.size!==1){conflicts++;continue}
  const row=unique.get(key)!,raw=row.payload.record,resource=attributes(row.payload.resource),attrs=attributes(raw),id=identity(row)
  const service=services.get(id)??{service:row.service,environment:row.environment,team:row.team,versions:new Set<string>(),lastSeenNs:0n,spanCount:0,requests:[],associations:[]}
  const version=resource['service.version'];if(typeof version==='string')service.versions.add(version)
  const start=BigInt(String(raw.startTimeUnixNano)),end=BigInt(String(raw.endTimeUnixNano)),kind=Number(raw.kind)
  service.spanCount++;if(end>service.lastSeenNs)service.lastSeenNs=end
  service.associations.push(...associations(resource,attrs,kind,end,{traceId:row.trace_id,spanId:row.span_id}))
  if(kind===2||kind===5){
   const status=raw.status as {code?:number}|undefined,http=Number(attrs['http.response.status_code']??attrs['http.status_code']??0),rpc=Number(attrs['rpc.grpc.status_code']??0)
   const endpoint=String(attrs['http.route']??(attrs['rpc.service']?String(attrs['rpc.service'])+'.'+String(attrs['rpc.method']??''):raw.name??'(unnamed)')).slice(0,240)
   service.requests.push({duration:end-start,error:status?.code===2||http>=500||rpc>0,endpoint})
  }
  services.set(id,service)
  if((kind===3||kind===4)&&!parentsWithChildren.has(key)){
   const edge={from:id,to:null,kind:'unresolved-target',observations:0},edgeKey=canonical(edge),old=edges.get(edgeKey)??edge
   old.observations++;edges.set(edgeKey,old)
  }
  const parent=typeof raw.parentSpanId==='string'&&raw.parentSpanId?unique.get(row.trace_id+':'+raw.parentSpanId.toLowerCase()):undefined
  if(raw.parentSpanId){
   const source=parent?identity(parent):null
   if(source!==id){
    const edge={from:source??id,to:source?id:null,kind:source?'observed-parent':'unresolved-parent',observations:0}
    const edgeKey=canonical(edge),old=edges.get(edgeKey)??edge;old.observations++;edges.set(edgeKey,old)
   }
  }
 }
 const seconds=Number(BigInt(through)-BigInt(from)+1n)/1e9
 const summarize=(requests:{duration:bigint;error:boolean}[])=>{
  const durations=requests.map(r=>r.duration).sort((a,b)=>a<b?-1:a>b?1:0)
  const percentile=(p:number)=>durations.length?durations[Math.max(0,Math.ceil(durations.length*p)-1)].toString():null
  return {requests:requests.length,errors:requests.filter(r=>r.error).length,requestsPerSecond:requests.length/seconds,p50Ns:percentile(.5),p95Ns:percentile(.95),p99Ns:percentile(.99)}
 }
 return {coverage:{population:'observed-retained-spans',fullTraffic:false,scanComplete:!truncated,conflictingIdentities:conflicts,missing:['upstream sampling and loss are unknown','full-traffic stats unavailable','associations describe observed identities, not complete infrastructure inventory','default detection unavailable','outbound alert continuity unavailable']},
  services:[...services.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([key,s])=>({key,service:s.service,environment:s.environment,team:s.team,versions:[...s.versions].sort(),spanCount:s.spanCount,lastSeenNs:s.lastSeenNs.toString(),freshness:BigInt(now)*1000000n-s.lastSeenNs>300000000000n?'stale':'recent',associations:mergeAssociations(s.associations),summary:summarize(s.requests),endpoints:[...new Set(s.requests.map(r=>r.endpoint))].sort().map(endpoint=>({endpoint,...summarize(s.requests.filter(r=>r.endpoint===endpoint))}))})),edges:[...edges.values()]}
}
export type Catalog=ReturnType<typeof catalog>
