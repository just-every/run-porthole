import type {Bindings} from '../../auth.server'
import {fail,scopeWithin,type Authority,type Scope} from '../security/authority'
import {dashboardBody,scopeLabel,timestamp,type DashboardRow} from '../dashboards/model'
import {eventScope,type representation} from './model'
import {eventById,overlayRows} from './store'
import {escape} from '../document'
export type OverlayEvent=ReturnType<typeof representation>
export async function validateOverlays(env:Bindings,actor:Authority,ids:string[],scope:Scope) {
 for(const id of ids) {
  const row=await eventById(env,actor,id)
  if(!row||!scopeWithin(eventScope(row),scope))fail('event_overlay_forbidden')
 }
}
export async function dashboardOverlays(request:Request,env:Bindings,row:DashboardRow) {
 const body=dashboardBody(JSON.parse(row.body)),ids=body.eventOverlays??[]
 if(row.state==='quarantined')return ids.map(()=>null)
 const params=new URL(request.url).searchParams,team=scopeLabel(params.get('team')??body.variables.team),environment=scopeLabel(params.get('environment')??body.variables.environment)
 const from=timestamp(params.get('from')??body.range.from),through=timestamp(params.get('through')??body.range.through)
 const events=await overlayRows(request,env,ids)
 return events.map(event=>event&&event.team===team&&event.environment===environment&&BigInt(event.occurredAt)>=BigInt(from)&&BigInt(event.occurredAt)<=BigInt(through)?event:null).sort((a,b)=>a===null?1:b===null?-1:a.occurredAt.localeCompare(b.occurredAt)||a.id.localeCompare(b.id))
}
export function overlayMarkup(events:(OverlayEvent|null)[],service?:string) {
 if(!events.length)return ''
 return `<section aria-label="Event timeline"><h3>Private event timeline</h3>${events.map(event=>event&&(!service||event.service===service)?`<p data-overlay="${event.id}"><a href="/app/events/${event.id}">${escape(event.title)}</a> · ${escape(event.severity)} · ${escape(event.occurredAt)}</p>`:'<p role="status">Event unavailable in this scope or time range.</p>').join('')}</section>`
}

/** Time coordinates use the same native chart axes; non-time widgets retain
 * the reference timeline without pretending their horizontal axis is time. */
export function overlayChart(markup:string,events:(OverlayEvent|null)[],service:string,from:string,through:string,kind='timeseries') {
 if(!['timeseries','heatmap'].includes(kind)||!markup.includes('</svg>'))return markup
 const start=BigInt(from),duration=BigInt(through)-start
 const markers=events.filter((event):event is OverlayEvent=>!!event&&event.service===service).map(event=>{
  const x=40+(duration?Number(BigInt(event.occurredAt)-start)/Number(duration):.5)*220
  return `<g data-event-marker="${event.id}" data-occurrence-ns="${event.occurredAt}"><title>${escape(event.title)} · ${escape(event.occurredAt)} ns</title><path d="M${x} 28V176" fill="none" stroke="currentColor" stroke-dasharray="3 3" stroke-width="1.5"/><circle cx="${x}" cy="28" r="3"/></g>`
 }).join('')
 return markup.replace('</svg>',markers+'</svg>')
}
