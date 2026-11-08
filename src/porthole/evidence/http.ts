import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {IntakeError,canonical} from '../ingest/model'
import {authority,fail,proofFence,type Authority} from '../security/authority'
import {input} from '../security/input'
import {privateHeaders} from '../document'
import {serviceRead} from '../services/read'
import {packet,release,selection,type PacketJob} from './model'
import {evidencePage} from './page'
const root='/api/porthole/v1/service-evidence'
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:privateHeaders})
const guard=(env:Bindings,actor:Authority,proof=false)=>{const fresh=proof?proofFence(actor):{sql:'1',args:[]};return env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${actor.fence} AND ${fresh.sql} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...actor.args,...fresh.args)}
export async function evidenceResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,screen=path.match(/^\/app\/services\/([a-f0-9]{32})\/evidence$/),history=path.match(/^\/app\/services\/evidence\/([a-f0-9-]{36})(?:\/(approve|cancel))?$/)
 if(path!==root&&!path.startsWith(root+'/')&&!screen&&!history)return null
 const html=!!screen||!!history
 try{
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.session.kind!=='native'||actor.member.role!=='owner')fail('export_owner_required')
  if(screen&&request.method==='GET'){
   const target=new URL('/api/porthole/v1/services',url);target.search=url.search
   const view=await serviceRead(new Request(target,{headers:request.headers}),env,actor),service=view.services.find(s=>s.id===screen[1])
   if(!service)fail('service_not_found',404)
   return evidencePage({serviceId:service.id,from:view.from,through:view.through,revision:service.metadata?.revision??0})
  }
  if(url.search)fail('invalid_evidence_query',400)
  if((path===root||screen)&&request.method==='POST'){
   let data:Record<string,unknown>
   data=await input(request,html?['fields']:[]);if(html)data.metadataRevision=Number(data.metadataRevision)
   const value=selection(data)
   if(screen&&value.serviceId!==screen[1])fail('invalid_evidence_selection',400)
   const result=await packet(request,env,actor,value),id=crypto.randomUUID()
   await env.DB.batch([guard(env,actor,true),env.DB.prepare("INSERT INTO porthole_service_packets VALUES(?,?,?,?,?,?,?,'preview',NULL)").bind(id,actor.member.operatorId,actor.member.revision,canonical(value),result.snapshot,result.capturedAt,result.digest)])
   return html?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/services/evidence/'+id}}):json({id,state:'preview',digest:result.digest,packet:result.body},201)
  }
  const parts=history?[history[1],history[2]]:path.slice(root.length+1).split('/')
  if(!/^[a-f0-9-]{36}$/.test(parts[0]??'')||parts.length>2)fail('evidence_not_found',404)
  const job=await env.DB.prepare(`SELECT * FROM porthole_service_packets WHERE id=? AND owner_ref=? AND ${actor.fence}`).bind(parts[0],actor.member.operatorId,...actor.args).first<PacketJob>()
  if(!job)fail('evidence_not_found',404)
  if(job.owner_revision!==actor.member.revision)fail('authority_changed',409)
  if(job.state==='quarantined')fail('evidence_inactive',409)
  const action=parts[1]
  if(request.method==='POST'){
   if(!['approve','cancel'].includes(action??''))fail('method_not_allowed',405)
   const data=await input(request)
   if(Object.keys(data).some(k=>!['confirm','digest'].includes(k))||data.confirm!==job.id||data.digest!==job.digest)fail('evidence_confirmation_required',409)
   if(action==='approve'){
    if(job.state!=='preview')fail('evidence_not_preview',409)
    const current=await packet(request,env,actor,selection(JSON.parse(job.selection)),job.snapshot,job.captured_at)
    if(current.digest!==job.digest)fail('evidence_changed',409)
   }
   const result=await env.DB.batch([guard(env,actor,true),env.DB.prepare(`UPDATE porthole_service_packets SET state=?,approved_at=? WHERE id=? AND state=?`).bind(action==='approve'?'approved':'cancelled',action==='approve'?Date.now():null,job.id,job.state)])
   if(!result[1].meta.changes)fail('evidence_state_changed',409)
   return html?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/services/evidence/'+job.id}}):json({id:job.id,state:action==='approve'?'approved':'cancelled',digest:job.digest})
  }
  if(action&&action!=='download')fail('evidence_not_found',404)
  if(action==='download'&&job.state!=='approved')fail('evidence_not_approved',409)
  if(job.state==='cancelled')return html?evidencePage({job}):json({id:job.id,state:job.state,digest:job.digest})
  const current=await packet(request,env,actor,selection(JSON.parse(job.selection)),job.snapshot,job.captured_at)
  if(current.digest!==job.digest)fail('evidence_changed',409)
  await release(env,actor,current.ids)
  const approvedSelection=selection(JSON.parse(job.selection))
  const live=await env.DB.prepare(`SELECT 1 FROM porthole_service_packets WHERE id=? AND state=? AND digest=? AND ${actor.fence}
   AND (SELECT COUNT(*) FROM porthole_telemetry_records WHERE id IN (SELECT value FROM json_each(?)))=?
   AND NOT EXISTS(SELECT 1 FROM porthole_export_exclusions WHERE record_id IN (SELECT value FROM json_each(?)))
   AND COALESCE((SELECT MAX(revision) FROM porthole_service_versions WHERE id=?),0)=?`).bind(job.id,job.state,job.digest,...actor.args,JSON.stringify(current.ids),current.ids.length,JSON.stringify(current.ids),approvedSelection.serviceId,approvedSelection.metadataRevision).first()
  if(!live)fail('evidence_state_changed',409)
  if(action==='download')return new Response(canonical({packet:current.body,digest:job.digest}),{headers:{...privateHeaders,'content-type':'application/json','content-disposition':'attachment; filename="porthole-service-evidence.json"'}})
  return html?evidencePage({job,body:current.body}):json({id:job.id,state:job.state,digest:job.digest,packet:current.body})
 }catch(error){const known=error instanceof AuthError||error instanceof IntakeError,status=known?error.status:503,code=known?error.code:'evidence_unavailable';return html?evidencePage({error:code,status}):json({error:code},status)}
}
