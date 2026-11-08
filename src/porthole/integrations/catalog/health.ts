import type {Bindings} from '../../../auth.server'
import {readTelemetry} from '../../ingest/read'
import {packFor,type Binding} from './model'
export async function setupHealth(request:Request,env:Bindings,b:Binding) {
 const p=packFor(b.pack),unknown=(reason:string)=>({state:'Unknown',reason,nextAction:`Check ${p.permissions}. Verify the ${'PORTHOLE_'+b.pack.toUpperCase()+'_ENDPOINT'} host variable and restart the collector.`,lastObservedAt:null as number|null})
 if(b.state!=='enabled')return unknown('Restored setup is inactive; review a current credential before collection.')
 const now=Date.now(),from=String(BigInt(now-20000)*1000000n),through=String(BigInt(now)*1000000n+999999n)
 let cursor:string|null=null,snapshot:number|undefined,records:any[]=[]
 for(let page=0;page<15;page++) {
  const url=new URL('/api/porthole/v1/ingest/records',request.url)
  for(const [k,v]of Object.entries({signal:'metrics',service:b.service,environment:b.environment,team:b.team,from,through,limit:'200',...(cursor?{cursor}:{}),...(snapshot===undefined?{}:{snapshot:String(snapshot)})}))url.searchParams.set(k,v)
  const response=await readTelemetry(new Request(url,{headers:request.headers}),env)
  if(!response.ok)return {...unknown('Analytical evidence unavailable; setup cannot be established.'),nextAction:'Restore the selected analytical worker and its coverage, then recheck collection.'}
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
 for(const [key,value]of Object.entries({signal:'logs',service:b.service,environment:b.environment,team:b.team,from,through,limit:'200'}))logURL.searchParams.set(key,value)
 const diagnostics=await readTelemetry(new Request(logURL,{headers:request.headers}),env)
 if(!diagnostics.ok)return unknown('Collector diagnostics unavailable; setup cannot be established.')
 const logBody=await diagnostics.json() as {records:any[];cursor:string|null}
 if(logBody.cursor)return unknown('Collector diagnostic scan is incomplete.')
 const failure=logBody.records.filter(r=>r.source_id===b.credential_id&&attributes(r.payload.resource?.attributes)['porthole.integration.id']===b.id&&['receiver_failed','endpoint_unavailable','authentication_denied','permission_denied'].includes(attributes(r.payload.record.attributes)['porthole.setup.failure'])).sort((a,b)=>b.event_time_ns.localeCompare(a.event_time_ns))[0]
 const failureCode=failure&&attributes(failure.payload.record.attributes)['porthole.setup.failure']
 if(failure&&Date.now()-Number(BigInt(failure.event_time_ns)/1000000n)>=0&&Date.now()-Number(BigInt(failure.event_time_ns)/1000000n)<=7500)return {...unknown('Collector reports '+failureCode+' for '+p.receiver+'. No raw collector error or secret is released.'),state:'Failed',failure:failureCode}
 if(!scraped.length)return unknown('No fresh exported scraper evidence. Absent service data does not establish health.')
 const value=(r:any)=>Number(r.payload.record.asInt??r.payload.record.asDouble)
 // Cumulative counters only establish a successful collection when they advance
 // between distinct observations. A pre-existing positive count is insufficient.
 const distinct=(rows:any[])=>rows.filter((r,i)=>i===0||r.event_time_ns!==rows[i-1].event_time_ns)
 const successes=distinct(scraped),failures=distinct(errors)
 if(failures.length&&value(failures[0])>0&&failures[0].event_time_ns>=successes[0].event_time_ns&&(failures.length<2||value(failures[0])>value(failures[1])))return {...unknown('Collector reports scraper errors for '+p.receiver+'. Collection permission or endpoint requires correction.'),state:'Failed'}
 const progress=successes.find((row,index)=>index+1<successes.length&&value(row)>value(successes[index+1]))
 if(!progress)return unknown('No completed successful scrape interval in the current evidence.')
 if(b.pack==='nginx') {
  const files=relevant.filter(r=>r.payload.metric?.name==='otelcol_fileconsumer_open_files_ratio').sort((a,b)=>b.event_time_ns.localeCompare(a.event_time_ns))
  if(!files.length)return unknown('No fresh filelog file-access telemetry. Verify the two Nginx log files and the collector diagnostic file.')
  if(value(files[0])<3)return {...unknown('Filelog cannot open the two Nginx log files and the collector diagnostic file.'),state:'Failed',failure:'log_file_access_denied',nextAction:'Grant the collector read access to PORTHOLE_NGINX_ACCESS_LOG and PORTHOLE_NGINX_ERROR_LOG and the private PORTHOLE_DIAGNOSTIC_LOG on the host, then restart collection.'}
 }
 if(p.metrics.some(metric=>!relevant.some(r=>r.payload.metric?.name===metric.name&&BigInt(r.event_time_ns)>=BigInt(progress.event_time_ns)-2500000000n)))return unknown('A required receiver signal is absent: '+p.metrics.filter(metric=>!relevant.some(r=>r.payload.metric?.name===metric.name&&BigInt(r.event_time_ns)>=BigInt(progress.event_time_ns)-2500000000n)).map(metric=>metric.name).join(', ')+'. No healthy setup is inferred.')
 return {state:'Collecting',reason:'Fresh stock scraper counters advanced without a new reported scraper error. This is setup evidence, not overall service health.',nextAction:'Inspect the preset dashboard and source statistics.',lastObservedAt:Number(BigInt(progress.event_time_ns)/1000000n)}
}
