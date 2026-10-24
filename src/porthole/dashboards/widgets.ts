import {escape} from '../document'
import {fail} from '../security/authority'
import {checked,empty,pointTable,table,utc,type WidgetInput} from './widgets/core'
import {distribution,heatmap,timeseries} from './widgets/charts'
import {groupMarkup} from './widgets/groups'
import {timestamp} from './model'
export {widgetKinds,type WidgetKind,type WidgetInput,type Point,type WidgetRecord} from './widgets/core'

function bodyText(body:unknown,depth=0):string {
 if(depth>32)fail('widget_log_body_too_deep',400)
 if(body===undefined||body===null)return ''
 if(typeof body!=='object'||Array.isArray(body))fail('unsupported_log_body_shape',400)
 const value=body as Record<string,unknown>
 for(const key of ['stringValue','intValue','doubleValue','boolValue','bytesValue'])if(Object.hasOwn(value,key)) {
  const scalar=value[key]
  if(!['string','number','boolean'].includes(typeof scalar))fail('unsupported_log_body_shape',400)
  return String(scalar)
 }
 if(value.arrayValue&&typeof value.arrayValue==='object'&&Array.isArray((value.arrayValue as {values?:unknown}).values))return '['+(value.arrayValue as {values:unknown[]}).values.map(v=>bodyText(v,depth+1)).join(', ')+']'
 if(value.kvlistValue&&typeof value.kvlistValue==='object'&&Array.isArray((value.kvlistValue as {values?:unknown}).values))return '{'+(value.kvlistValue as {values:{key:string;value:unknown}[]}).values.map(v=>{
  if(typeof v.key!=='string')fail('unsupported_log_body_shape',400)
  return v.key+': '+bodyText(v.value,depth+1)
 }).join(', ')+'}'
 if(!Object.keys(value).length)return ''
 return fail('unsupported_log_body_shape',400)
}
function logs(input:WidgetInput):string {
 if(!input.records.length)return empty()
 const from=BigInt(input.from),through=BigInt(input.through)
 const rows=input.records.map(record=>{
  if(!record||typeof record.id!=='string'||!record.payload||!record.payload.record)fail('invalid_widget_log_record',400)
  const time=BigInt(timestamp(record.event_time_ns))
  if(time<from||time>through)fail('widget_record_outside_selected_range',400)
  return [utc(record.event_time_ns),record.event_time_ns,bodyText(record.payload.record.body)]
 })
 return table(['UTC time','Unix nanoseconds','Log body'],rows,input.title+' — actual log bodies')
}
export function widgetMarkup(raw:WidgetInput):string {
 const input=checked(raw)
 switch(input.kind) {
  case 'query_value':return input.value===null?empty():`<p><strong>${escape(input.value)}</strong> ${escape(input.unit)}</p>`
  case 'timeseries':return timeseries(input)
  case 'table':return pointTable(input)
  case 'distribution':return distribution(input)
  case 'heatmap':return heatmap(input)
  case 'top_list':case 'list':case 'pie':case 'treemap':return groupMarkup(input)
  case 'log_stream':return logs(input)
  case 'notes':
   if(typeof input.note!=='string')fail('notes_require_explicit_plain_text',400)
   return input.note.length?`<p>${escape(input.note).replaceAll('\n','<br>')}</p>`:'<p role="status">No note text.</p>'
  default:return fail('unsupported_dashboard_widget',400)
 }
}
