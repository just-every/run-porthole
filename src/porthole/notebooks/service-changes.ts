import {attributes} from '../ingest/normalize'
import {escape} from '../document'
import {fail} from '../security/authority'
import type {WidgetRecord} from '../dashboards/widgets'

export interface ServiceChange {recordId:string;timeNs:string;kind:string;changeId:string;previousVersion:string;version:string;summary:string}
// These explicitly emitted OTLP log attributes describe observed evidence.
// They do not establish provider authenticity or authorize a deployment.
export function serviceChanges(records:WidgetRecord[]):ServiceChange[] {
 if(!records.length)fail('service_change_evidence_required',422)
 return records.map(row=>{
  const attrs=attributes(row.payload.record.attributes)
  const text=(key:string,optional=false)=>{
   const value=attrs[key]
   if(optional&&value===undefined)return ''
   if(typeof value!=='string'||!value.trim()||value.length>2000)fail('service_change_evidence_required',422)
   return value
  }
  const kind=text('change.kind')
  if(!['deployment','configuration','feature_flag'].includes(kind))fail('service_change_evidence_required',422)
  return {recordId:row.id,timeNs:row.event_time_ns,kind,changeId:text('change.id'),previousVersion:text('change.previous_version',true),version:text('change.version'),summary:text('change.summary')}
 })
}
export function serviceChangeMarkup(changes:ServiceChange[]):string {
 return `<p>Observed service-change evidence. Source facts do not prove causation or authorize any action.</p><ul>${changes.map(change=>`<li><p>${escape(change.kind.replaceAll('_',' '))}: ${escape(change.summary)}</p><p>Source change: <code>${escape(change.changeId)}</code></p><p>Previous version: ${escape(change.previousVersion||'Not supplied')}</p><p>Observed version: ${escape(change.version)}</p><p>Source time in nanoseconds: <code>${escape(change.timeNs)}</code></p></li>`).join('')}</ul>`
}
