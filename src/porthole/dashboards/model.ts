import {fail} from '../security/authority'
export interface Panel {id:string;title:string;signal:'metrics'|'logs'|'traces';service:string;aggregate:'average'|'count'|'p95';unit:string;metric?:string}
export interface Dashboard {panels:Panel[];variables:{team:string;environment:string};range:{from:string;through:string};annotations:{at:string;label:string}[]}
export interface DashboardRow {id:string;name:string;scope:string;body:string;revision:number;state:string;created_at:number;updated_at:number}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('invalid_dashboard',400)
export const label=(v:unknown,max=120):string=>typeof v==='string'&&v.length>0&&v.length<=max?v:fail('invalid_dashboard_label',400)
export const scopeLabel=(v:unknown):string=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(v)?v:fail('invalid_dashboard_scope',400)
export const timestamp=(v:unknown):string=>typeof v==='string'&&/^\d{1,20}$/.test(v)&&BigInt(v)<=18446744073709551615n?v:fail('invalid_dashboard_range',400)
export function dashboardBody(raw:unknown):Dashboard {
 const b=object(raw),vars=object(b.variables),range=object(b.range)
 if(Object.keys(b).some(k=>!['panels','variables','range','annotations'].includes(k))||!Array.isArray(b.panels)||b.panels.length>30||!Array.isArray(b.annotations)||b.annotations.length>100)fail('invalid_dashboard',400)
 const from=timestamp(range.from),through=timestamp(range.through)
 if(BigInt(from)>BigInt(through))fail('invalid_dashboard_range',400)
 const ids=new Set<string>()
 const panels=b.panels.map(raw=>{const p=object(raw),id=scopeLabel(p.id),signal=String(p.signal)
  if(ids.has(id)||!['metrics','logs','traces'].includes(signal)||Object.keys(p).some(k=>!['id','title','signal','service','aggregate','unit','metric'].includes(k)))fail('invalid_panel',400)
  ids.add(id)
  if(p.aggregate!==({metrics:'average',logs:'count',traces:'p95'} as Record<string,string>)[signal])fail('unsupported_panel_aggregate',400)
  return {id,...(signal==='metrics'?{metric:label(p.metric)}:{}),title:label(p.title),signal,service:scopeLabel(p.service),aggregate:p.aggregate,unit:typeof p.unit==='string'&&p.unit.length<=32?p.unit:fail('invalid_panel_unit',400)} as Panel
 })
 return {panels,variables:{team:scopeLabel(vars.team),environment:scopeLabel(vars.environment)},range:{from,through},annotations:b.annotations.map(raw=>{const a=object(raw);return {at:timestamp(a.at),label:label(a.label,300)}})}
}
