import type {Bindings} from '../../../auth.server'
import {readTelemetry} from '../../ingest/read'
import {packFor,type Binding} from './model'
export async function setupHealth(request:Request,env:Bindings,b:Binding) {
 const p=packFor(b.pack),unknown=(reason:string)=>({state:'Unknown',reason,nextAction:`Check ${p.permissions}. Verify the ${'PORTHOLE_'+b.pack.toUpperCase()+'_ENDPOINT'} host variable and restart the collector.`,lastObservedAt:null as number|null})
 if(b.state!=='enabled')return unknown('Restored setup is inactive; review a current credential before collection.')
 const from=String(BigInt(Date.now()-20000)*1000000n)
 let cursor:string|null=null,snapshot:number|undefined,records:any[]=[]
 for(let page=0;page<15;page++) {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [k,v]of Object.entries({signal:'metrics',service:b.service,environment:b.environment,team:b.team,from,limit:'200',...(cursor?{cursor}:{}),...(snapshot===undefined?{}:{snapshot:String(snapshot)})}))url.searchParams.set(k,v)
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env)
  if(!response.ok)return unknown('Analytical evidence unavailable; setup cannot be established.')
  const body=await response.json() as {records:any[];cursor:string|null;snapshot:number};snapshot=body.snapshot
  records.push(...body.records);cursor=body.cursor
  if(!cursor)break
 }
 if(cursor)return unknown('Scraper evidence scan is incomplete; narrow the collection scope.')
 const attributes=(items:any[])=>Object.fromEntries((items??[]).map(a=>[a.key,a.value.stringValue??a.value.intValue??a.value.doubleValue]))
 const relevant=records.filter(r=>r.source_id===b.credential_id&&attributes(r.payload.resource?.attributes)['porthole.integration.id']===b.id)
 const points=relevant.filter(r=>/^otelcol_scraper_(scraped|errored)_metric_points(?:_total)?$/.test(r.payload.metric?.name)&&attributes(r.payload.record?.attributes).scraper===p.receiver)
 const latest=(kind:string)=>points.filter(r=>r.payload.metric.name.includes(kind)).sort((a,b)=>b.event_time_ns.localeCompare(a.event_time_ns))
 const scraped=latest('scraped'),errors=latest('errored')
 const logURL=new URL('/api/porthole/v1/ingest/records',request.url)
 for(const [key,value]of Object.entries({signal:'logs',service:b.service,environment:b.environment,team:b.team,from,limit:'200'}))logURL.searchParams.set(key,value)
 const diagnostics=await readTelemetry(new Request(logURL,{headers:request.headers}),env)
 if(!diagnostics.ok)return unknown('Collector diagnostics unavailable; setup cannot be established.')
 const logBody=await diagnostics.json() as {records:any[];cursor:string|null}
 if(logBody.cursor)return unknown('Collector diagnostic scan is incomplete.')
 const failure=logBody.records.filter(r=>r.source_id===b.credential_id&&attributes(r.payload.resource?.attributes)['porthole.integration.id']===b.id&&['receiver_failed','endpoint_unavailable','authentication_denied','permission_denied'].includes(attributes(r.payload.record.attributes)['porthole.setup.failure'])).sort((a,b)=>b.event_time_ns.localeCompare(a.event_time_ns))[0]
 const failureCode=failure&&attributes(failure.payload.record.attributes)['porthole.setup.failure']
 if(failure&&(!scraped.length||failure.event_time_ns>=scraped[0].event_time_ns))return {...unknown('Collector reports '+failureCode+' for '+p.receiver+'. No raw collector error or secret is released.'),state:'Failed',failure:failureCode}
 if(!scraped.length)return unknown('No fresh exported scraper evidence. Absent service data does not establish health.')
 const value=(r:any)=>Number(r.payload.record.asInt??r.payload.record.asDouble)
 // Cumulative counters only establish a successful collection when they advance
 // between distinct observations. A pre-existing positive count is insufficient.
 const distinct=(rows:any[])=>rows.filter((r,i)=>i===0||r.event_time_ns!==rows[i-1].event_time_ns)
 const successes=distinct(scraped),failures=distinct(errors)
 if(failures.length&&value(failures[0])>0&&(failures.length<2||value(failures[0])>value(failures[1])))return {...unknown('Collector reports scraper errors for '+p.receiver+'. Collection permission or endpoint requires correction.'),state:'Failed'}
 if(successes.length<2||value(successes[0])<=value(successes[1]))return unknown('No completed successful scrape interval in the current evidence.')
 if(p.metrics.some(metric=>!relevant.some(r=>r.payload.metric?.name===metric.name)))return unknown('A required receiver signal is absent: '+p.metrics.filter(metric=>!relevant.some(r=>r.payload.metric?.name===metric.name)).map(metric=>metric.name).join(', ')+'. No healthy setup is inferred.')
 return {state:'Collecting',reason:'Fresh stock scraper counters advanced without a new reported scraper error. This is setup evidence, not overall service health.',nextAction:'Inspect the preset dashboard and source statistics.',lastObservedAt:Number(BigInt(successes[0].event_time_ns)/1000000n)}
}
