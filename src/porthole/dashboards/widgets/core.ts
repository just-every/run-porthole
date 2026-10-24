import {escape} from '../../document'
import {fail} from '../../security/authority'
import {timestamp} from '../model'

import {widgetKinds} from './kinds'
export {widgetKinds,type WidgetKind} from './kinds'
import type {WidgetKind} from './kinds'
export interface Point {timeNs:string;value:number;series:string}
export interface WidgetRecord {id:string;event_time_ns:string;payload:{record:Record<string,unknown>}}
export interface WidgetInput {kind:WidgetKind|string;title:string;unit:string;value:number|null;points:Point[];records:WidgetRecord[];from:string;through:string;note?:string}
export const empty=()=>'<p role="status">No data in the selected range.</p>'
export const number=(value:number)=>escape(value)
export function checked(input:WidgetInput):WidgetInput {
 if(!(widgetKinds as readonly string[]).includes(input.kind))fail('unsupported_dashboard_widget',400)
 if(!Array.isArray(input.points)||input.points.length>2000||!Array.isArray(input.records)||input.records.length>2000||typeof input.title!=='string'||typeof input.unit!=='string'||!(input.value===null||typeof input.value==='number'&&Number.isFinite(input.value)))fail('invalid_widget_data',400)
 const from=BigInt(timestamp(input.from)),through=BigInt(timestamp(input.through))
 if(from>through)fail('invalid_dashboard_range',400)
 for(const point of input.points) {
  if(!point||typeof point.value!=='number'||!Number.isFinite(point.value)||typeof point.series!=='string')fail('invalid_widget_point',400)
  const time=BigInt(timestamp(point.timeNs))
  if(time<from||time>through)fail('widget_point_outside_selected_range',400)
 }
 return input
}
export function utc(ns:string):string {return new Date(Number(BigInt(ns)/1000000n)).toISOString()}
export const short=(value:number)=>String(Number(value.toPrecision(5)))
export function svg(title:string,content:string,height=220):string {
 return `<svg viewBox="0 0 280 ${height}" width="100%" role="img" aria-label="${escape(title)}" font-family="inherit" font-size="13" fill="currentColor">${content}</svg>`
}
export function table(headers:string[],rows:(string|number)[][],caption:string):string {
 return `<div style="max-width:100%;overflow-x:auto"><table><caption>${escape(caption)}</caption><thead><tr>${headers.map(h=>`<th scope="col">${escape(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(value=>`<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
}
export function pointTable(input:WidgetInput):string {
 return input.points.length?table(['UTC time','Unix nanoseconds','Series','Value','Unit'],input.points.map(p=>[utc(p.timeNs),p.timeNs,p.series,p.value,input.unit]),input.title+' — actual values'):empty()
}
export function grouped(input:WidgetInput):{series:string;mean:number;count:number}[] {
 const groups=new Map<string,number[]>()
 for(const point of input.points) {const group=groups.get(point.series)??[];group.push(point.value);groups.set(point.series,group)}
 return [...groups].map(([series,values])=>{
  const mean=values.reduce((sum,value)=>sum+value/values.length,0)
  if(!Number.isFinite(mean))fail('widget_numeric_overflow_reduce_value_range',400)
  return {series,mean,count:values.length}
 }).sort((a,b)=>b.mean-a.mean||a.series.localeCompare(b.series))
}
export function range(input:WidgetInput):{min:number;max:number;span:number} {
 const values=input.points.map(p=>p.value),min=Math.min(...values),max=Math.max(...values),span=max-min
 if(!Number.isFinite(span))fail('widget_numeric_range_too_wide',400)
 return {min,max,span}
}
export const clock=(ns:string)=>utc(ns).slice(11,23)+'Z'
