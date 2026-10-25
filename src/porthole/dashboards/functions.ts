import {fail} from '../security/authority'
import type {Point} from './widgets'

export type PanelFunction = {kind:'rollup';seconds:number;operation:'average'|'sum'} | {kind:'rank';limit:number} | {kind:'smooth';window:number} | {kind:'rate'}
export function panelFunctions(raw:unknown):PanelFunction[] {
 if(!Array.isArray(raw)||raw.length>8)fail('dashboard_functions_require_at_most_eight_steps',400)
 return raw.map(value=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail('invalid_dashboard_function',400)
  const step=value as Record<string,unknown>,keys=step.kind==='rollup'?['kind','seconds','operation']:step.kind==='rank'?['kind','limit']:step.kind==='smooth'?['kind','window']:step.kind==='rate'?['kind']:[]
  if(!keys.length||Object.keys(step).length!==keys.length||Object.keys(step).some(key=>!keys.includes(key)))fail('unsupported_dashboard_function_use_rollup_rank_smooth_or_rate',400)
  if(step.kind==='rollup'&&(!Number.isSafeInteger(step.seconds)||Number(step.seconds)<1||Number(step.seconds)>604800||!['average','sum'].includes(String(step.operation))))fail('rollup_requires_seconds_one_to_604800_and_average_or_sum',400)
  if(step.kind==='rank'&&(!Number.isSafeInteger(step.limit)||Number(step.limit)<1||Number(step.limit)>2000))fail('rank_requires_limit_one_to_2000',400)
  if(step.kind==='smooth'&&(!Number.isSafeInteger(step.window)||Number(step.window)<1||Number(step.window)>2000))fail('smooth_requires_window_one_to_2000',400)
  return step as PanelFunction
 })
}
const mean=(values:number[])=>values.reduce((sum,value)=>sum+value/values.length,0)
function series(points:Point[]):[string,Point[]][] {
 const groups=new Map<string,Point[]>()
 for(const point of points) {const group=groups.get(point.series)??[];group.push(point);groups.set(point.series,group)}
 return [...groups].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([name,values])=>[name,values.toSorted((a,b)=>BigInt(a.timeNs)<BigInt(b.timeNs)?-1:BigInt(a.timeNs)>BigInt(b.timeNs)?1:0)])
}
export function applyFunctions(input:Point[],steps:PanelFunction[],from:string,unit:string):{points:Point[];unit:string;value:number|null} {
 let points=input.map(point=>({...point}))
 for(const step of steps) {
  if(step.kind==='rollup') {
   const interval=BigInt(step.seconds)*1000000000n,origin=BigInt(from)
   points=series(points).flatMap(([name,values])=>{
    const buckets=new Map<string,number[]>()
    for(const point of values) {const time=String(origin+(BigInt(point.timeNs)-origin)/interval*interval),bucket=buckets.get(time)??[];bucket.push(point.value);buckets.set(time,bucket)}
    return [...buckets].map(([timeNs,values])=>({timeNs,series:name,value:step.operation==='sum'?values.reduce((sum,value)=>sum+value,0):mean(values)}))
   })
  } else if(step.kind==='rank') {
   const selected=new Set(series(points).map(([name,values])=>({name,value:mean(values.map(point=>point.value))})).sort((a,b)=>b.value-a.value||(a.name<b.name?-1:a.name>b.name?1:0)).slice(0,step.limit).map(row=>row.name))
   points=points.filter(point=>selected.has(point.series))
  } else if(step.kind==='smooth') {
   points=series(points).flatMap(([,values])=>values.map((point,index)=>({...point,value:mean(values.slice(Math.max(0,index-step.window+1),index+1).map(value=>value.value))})))
  } else {
   points=series(points).flatMap(([,values])=>values.slice(1).map((point,index)=>{
    const previous=values[index],elapsed=BigInt(point.timeNs)-BigInt(previous.timeNs)
    if(elapsed<=0n)fail('rate_requires_distinct_timestamps_in_each_series',400)
    if(point.value<previous.value)fail('rate_counter_decreased_choose_a_window_without_reset',400)
    return {...point,value:(point.value-previous.value)/(Number(elapsed)/1e9)}
   }))
   unit=unit+' per second'
  }
  if(points.some(point=>!Number.isFinite(point.value)))fail('dashboard_function_overflow_reduce_value_range',400)
 }
 const value=points.length?mean(points.map(point=>point.value)):null
 if(value!==null&&!Number.isFinite(value))fail('dashboard_function_overflow_reduce_value_range',400)
 return {points,unit,value}
}
export function functionDescription(steps:PanelFunction[]):string {
 return steps.map(step=>step.kind==='rollup'?`rollup ${step.operation} every ${step.seconds} seconds from the selected range start; missing buckets stay absent`:step.kind==='rank'?`top ${step.limit} series by observed mean; ties use series identity`:step.kind==='smooth'?`trailing mean of at most ${step.window} observed samples per series; gaps stay absent`:'counter rate per second between adjacent observations per series; first samples omitted, resets refused').join('; then ')
}
