import {readTelemetry} from '../ingest/read'
import {attributes} from '../ingest/normalize'
import type {TraceRecord} from '../traces/graph'
import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail} from '../security/authority'
import {input} from '../security/input'
import {privateHeaders,operationDocument,escape as e} from '../document'
import {secretHash} from '../credentials/policy'
import {verifyCredential,CredentialLimit} from '../credentials/verify'
import {gaps,installReport} from './model'
const root='/api/porthole/v1/fleet',screen='/app/settings/fleet'
type FleetRow={id:string;service:string;environment:string;team:string;report:string;observed_at:number;state:string;credential_live:number}
const json=(v:unknown,status=200)=>Response.json(v,{status,headers:privateHeaders})
export async function fleetResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname
 if(![root,root+'/report',screen].includes(path))return null
 try {
  if(url.search)fail('invalid_fleet_query',400)
  if(path===root+'/report') {
   if(request.method!=='POST')fail('method_not_allowed',405)
   const data=await input(request),valid=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(v)
   if(Object.keys(data).sort().join(',')!==['id','service','environment','team','report','state'].sort().join(',')||![data.id,data.service,data.environment,data.team].every(valid)||!['active','stopped'].includes(String(data.state)))fail('invalid_install',400)
   const report=installReport(data.report),scope={services:[String(data.service)],environments:[String(data.environment)],teams:[String(data.team)]},hash=await secretHash((request.headers.get('authorization')??'').slice(7))
   const result=await verifyCredential(request,env,{action:'telemetry.write',scope,dataScope:scope,writes:(fence,effective)=>{
    if(!effective.signals.includes('logs')||report.services.some(s=>!effective.services.includes('*')&&!effective.services.includes(s)))fail('credential_scope_forbidden')
    return [env.DB.prepare(`INSERT INTO porthole_fleet_installs(id,credential_id,service,environment,team,report,observed_at,state)
     SELECT ?,id,?,?,?,?,?,? FROM porthole_credentials WHERE secret_hash=? AND class='ingest' AND ${fence.sql}
     ON CONFLICT(id) DO UPDATE SET report=excluded.report,observed_at=excluded.observed_at,state=excluded.state
     WHERE credential_id=excluded.credential_id AND service=excluded.service AND environment=excluded.environment AND team=excluded.team
     AND json_extract(report,'$.sequence')<json_extract(excluded.report,'$.sequence') AND state!='quarantined'`)
     .bind(data.id,data.service,data.environment,data.team,JSON.stringify(report),Date.now(),data.state,hash,...fence.args)]
   }})
   if(!result.results[0].meta.changes)fail('install_binding_or_sequence_changed',409)
   return json({id:data.id,state:data.state,gaps:gaps(report),coverage:'Collector reports are observations, never proof of telemetry completeness.'})
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  const actor=await authority(request,env)
  if(actor.session.kind!=='native'||actor.member.role!=='owner')fail('fleet_owner_required')
  // Read live credential custody and final owner authority in one release query.
  const selection=env.DB.prepare(`SELECT f.id,f.service,f.environment,f.team,f.report,f.observed_at,f.state,
   CASE WHEN c.class='ingest' AND c.status='active' AND c.expires_at>? AND o.status='active' AND o.role=m.role AND m.role IN ('owner','admin')
    AND EXISTS(SELECT 1 FROM json_each(c.scope,'$.services') WHERE value='*' OR value=f.service)
    AND EXISTS(SELECT 1 FROM json_each(c.scope,'$.environments') WHERE value='*' OR value=f.environment)
    AND EXISTS(SELECT 1 FROM json_each(c.scope,'$.teams') WHERE value='*' OR value=f.team)
    AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.services') WHERE value='*' OR value=f.service)
    AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.environments') WHERE value='*' OR value=f.environment)
    AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.teams') WHERE value='*' OR value=f.team) THEN 1 ELSE 0 END AS credential_live
   FROM porthole_fleet_installs f LEFT JOIN porthole_credentials c ON c.id=f.credential_id LEFT JOIN porthole_members m ON m.operator_id=c.custodian_id LEFT JOIN oa_operators o ON o.id=m.operator_id
   WHERE ${actor.fence}
    AND EXISTS(SELECT 1 FROM json_each(?) WHERE value='*' OR value=f.service)
    AND EXISTS(SELECT 1 FROM json_each(?) WHERE value='*' OR value=f.environment)
    AND EXISTS(SELECT 1 FROM json_each(?) WHERE value='*' OR value=f.team)
   ORDER BY f.id LIMIT 201`).bind(Date.now(),...actor.args,JSON.stringify(actor.member.scope.services),JSON.stringify(actor.member.scope.environments),JSON.stringify(actor.member.scope.teams))
  let rows=await selection.all<FleetRow>()
  const observed:TraceRecord[]=[],recordIds:string[]=[]
  let coverageComplete=true
  if(rows.results.some(row=>installReport(JSON.parse(row.report)).platform==='kubernetes')) {
   const target=new URL('/api/porthole/v1/ingest/records?signal=traces&limit=200',url)
   let cursor:string|null=null
   do {
    if(cursor)target.searchParams.set('cursor',cursor)
    const result=await readTelemetry(new Request(target,{headers:request.headers}),env)
    if(!result.ok)fail('fleet_telemetry_unavailable',503)
    const page=await result.json() as {records:TraceRecord[];cursor:string|null;snapshot:number}
    observed.push(...page.records);recordIds.push(...page.records.map(r=>r.id));cursor=page.cursor
    target.searchParams.set('snapshot',String(page.snapshot))
   }while(cursor&&observed.length<2000)
   coverageComplete=!cursor
  }
  const latest=await authority(request,env)
  if(latest.member.revision!==actor.member.revision||latest.session.id!==actor.session.id)fail('authority_changed',409)
  rows=await selection.all<FleetRow>()
  const releaseActor=await authority(request,env)
  if(releaseActor.member.revision!==actor.member.revision||releaseActor.session.id!==actor.session.id)fail('authority_changed',409)
  if(recordIds.length){const retained=await env.DB.prepare(`SELECT COUNT(*) AS n FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?)) AND ${actor.fence}`).bind(JSON.stringify(recordIds),...actor.args).first<{n:number}>();if(retained?.n!==recordIds.length)fail('fleet_evidence_changed',409)}
  const installs=rows.results.slice(0,200).map(row=>{
   const report=installReport(JSON.parse(row.report)),stale=row.state!=='active'||!row.credential_live||Date.now()-row.observed_at>90000
   const services=new Set([...report.services.filter(service=>actor.member.scope.services.includes('*')||actor.member.scope.services.includes(service)),...observed.filter(r=>attributes(r.payload.resource?.attributes)['porthole.install.id']===row.id&&/obi|ebpf/i.test(String(r.payload.scope?.name??''))).map(r=>r.service)])
   const coverage=[...services].map(service=>{const spans=observed.filter(r=>r.service===service&&attributes(r.payload.resource?.attributes)['porthole.install.id']===row.id&&/obi|ebpf/i.test(String(r.payload.scope?.name??'')));return {service,status:spans.length?'retained-ebpf-spans':'unproven',spans:spans.length,freshness:!stale&&report.collector==='running'&&spans.some(r=>Number(BigInt(String(r.payload.record.startTimeUnixNano??'0'))/1000000n)>Date.now()-90000)?'recent':'stale',complete:coverageComplete,action:'Open Services to inspect retained spans, map and request summaries.'}})
   return {id:row.id,service:row.service,environment:row.environment,team:row.team,report,observedAt:row.observed_at,state:row.state,freshness:stale?'stale':'recent',gaps:gaps(report).filter(g=>g.code!=='obi-no-observed-spans'||!coverage.some(c=>c.spans>0&&c.freshness==='recent')),credentialStatus:row.state==='quarantined'?'not-restored':row.credential_live?'current':'revoked-or-unavailable',coverage}
  })
  const view={installs,complete:rows.results.length<=200,meaning:'Reports are local observations. Recent reports and granted privileges do not establish health, full traffic or successful collection.'}
  if(path===root)return json(view)
  return operationDocument('Fleet coverage',`<a href="${root}">Read fleet as JSON</a> · <a href="/app/services">Inspect Services</a><p>${e(view.meaning)}</p>${!view.complete?'<p role="status">Partial list: install budget reached.</p>':''}${installs.length?installs.map(i=>`<section><h2>${e(i.id)}</h2><p>${e(i.report.platform)} · ${e(i.report.node)} · ${e(i.freshness)} · ${e(i.state)}</p><dl><dt>Service</dt><dd>${e(i.service)} · ${e(i.environment)} · ${e(i.team)}</dd><dt>Collector</dt><dd>${e(i.report.collectorVersion)} · ${e(i.report.collector)}</dd><dt>OBI</dt><dd>${e(i.report.obiVersion??'Not installed')} · ${e(i.report.obi)}</dd><dt>Kernel and runtime</dt><dd>${e(i.report.kernel)} · ${e(i.report.runtime)}</dd><dt>Runtime limits</dt><dd>${e(i.report.limits.join(', ')||'Not reported')}</dd><dt>Requested privileges</dt><dd>${e(i.report.requested.join(', '))}</dd><dt>Granted privileges</dt><dd>${e(i.report.granted.join(', ')||'None observed')}</dd><dt>Credential</dt><dd>${e(i.credentialStatus)}</dd><dt>Last observation</dt><dd>${e(new Date(i.observedAt).toISOString())}</dd></dl><h3>Coverage gaps and next actions</h3>${i.gaps.length?`<ul>${i.gaps.map(g=>`<li><strong>${e(g.code)}</strong>: ${e(g.action)}</li>`).join('')}</ul>`:'<p>No missing privilege reported. Telemetry completeness remains unproven.</p>'}<h3>Service eBPF coverage</h3>${i.coverage.length?`<ul>${i.coverage.map(c=>`<li>${e(c.service)}: ${e(c.status)} · ${c.spans} retained spans · ${e(c.freshness)} · ${c.complete?'complete bounded scan':'partial scan'}. ${e(c.action)}</li>`).join('')}</ul>`:'<p>No observed service coverage. Drive real traffic and inspect instrumentation diagnostics.</p>'}<p>Uninstall stops fresh collection; retained telemetry stays queryable and this record becomes stale. Restored records remain inactive without credentials.</p></section>`).join(''):'<p>No install observations yet.</p>'}`)
 }catch(error){const known=error instanceof AuthError||error instanceof CredentialLimit,status=known?error.status:503,code=known?error.code:'fleet_unavailable';return path===screen?operationDocument('Fleet coverage',`<p role="alert">${e(code.replaceAll('_',' '))}</p><a href="${screen}">Reload fleet</a>`,status):json({error:code},status)}
}
