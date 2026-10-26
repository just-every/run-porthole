import { fail, parseScope, type Scope } from '../security/authority'
import { text } from '../security/input'

export interface Definition {
 type:'event-ratio'|'metric-ratio'; scope:Scope; sourceId:string; targetPpm:number
 latencyMs:number|null; goodMetric:string|null; totalMetric:string|null
 exclusions:{from:number;through:number;reason:string}[]
}
export interface SloRow {id:string;revision:number;name:string;definition:string;owner_id:string;created_at:number;state:string}
export function timestamp(value:unknown):number {
 if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>8640000000000000)fail('invalid_time',400)
 return value
}
export function windowInput(data:Record<string,unknown>) {
 const from=timestamp(data.from),through=timestamp(data.through)
 if(through<=from||through-from>31*86400000||through>Date.now())fail('invalid_window',400)
 return {from,through}
}
export function definitionInput(value:unknown):Definition {
 if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_slo',400)
 const d=value as Record<string,unknown>
 if(Object.keys(d).some(k=>!['type','scope','sourceId','targetPpm','latencyMs','goodMetric','totalMetric','exclusions'].includes(k)))fail('invalid_slo',400)
 if(d.type!=='event-ratio'&&d.type!=='metric-ratio')fail('unsupported_slo_type',400)
 const scope=parseScope(d.scope)
 if(Object.values(scope).some(v=>v.length!==1||v.includes('*')))fail('explicit_slo_scope_required',400)
 const sourceId=text(d.sourceId,36)
 if(!/^[a-f0-9-]{36}$/.test(sourceId))fail('invalid_source',400)
 if(typeof d.targetPpm!=='number'||!Number.isSafeInteger(d.targetPpm)||d.targetPpm<1||d.targetPpm>=1000000)fail('invalid_target',400)
 const latencyMs=d.latencyMs??null,goodMetric=d.goodMetric??null,totalMetric=d.totalMetric??null
 if(d.type==='event-ratio') {
  if(latencyMs!==null&&(typeof latencyMs!=='number'||!Number.isSafeInteger(latencyMs)||latencyMs<1||latencyMs>86400000)||goodMetric!==null||totalMetric!==null)fail('invalid_event_definition',400)
 } else if(latencyMs!==null||typeof goodMetric!=='string'||typeof totalMetric!=='string'||goodMetric===totalMetric||!goodMetric.length||!totalMetric.length||goodMetric.length>120||totalMetric.length>120)fail('invalid_metric_definition',400)
 if(!Array.isArray(d.exclusions)||d.exclusions.length>32)fail('invalid_exclusions',400)
 const exclusions=d.exclusions.map(v=>{
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='from,reason,through')fail('invalid_exclusions',400)
  const from=timestamp(v.from),through=timestamp(v.through),reason=text(v.reason,240)
  if(through<=from)fail('invalid_exclusions',400)
  return {from,through,reason}
 }).sort((a,b)=>a.from-b.from)
 if(exclusions.some((v,i)=>i>0&&v.from<exclusions[i-1].through))fail('overlapping_exclusions',400)
 return {type:d.type,scope,sourceId,targetPpm:d.targetPpm,latencyMs:latencyMs as number|null,goodMetric:goodMetric as string|null,totalMetric:totalMetric as string|null,exclusions}
}
