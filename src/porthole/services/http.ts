import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {privateHeaders} from '../document'
import {IntakeError} from '../ingest/model'
import {authority,fail,memberFor,proofFence,scopeWithin} from '../security/authority'
import {input} from '../security/input'
import {safeLink} from './model'
import {serviceRead} from './read'
import {servicesPage} from './page'

const root='/api/porthole/v1/services',screen='/app/services',settings='/app/settings/services'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function servicesResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),path=url.pathname,base=[root,screen,settings].find(r=>path===r||path.startsWith(r+'/'))
 if(!base)return null
 const html=base!==root,config=base===settings,id=path===base?undefined:path.slice(base.length+1)
 try {
  if(id&&!/^[a-f0-9]{32}$/.test(id))fail('invalid_service_id',400)
  if(config&&!id)fail('service_not_found',404)
  if(!['GET','POST'].includes(request.method))fail('method_not_allowed',405)
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
  const owner=actor.session.kind==='native'&&actor.member.role==='owner'
  if((config||request.method==='POST')&&!owner)fail('service_owner_required')
  if(request.method==='POST'&&(!id||base===screen||url.search))fail('invalid_service_query',400)
  // Resolve the Settings directory before the catalog's final source and
  // authority fence. No later directory read can release an older catalog.
  const candidates=config&&request.method==='GET'?(await env.DB.prepare(`SELECT o.id,o.display_name,m.scope,m.role FROM oa_operators o JOIN porthole_members m ON m.operator_id=o.id WHERE o.status='active' AND m.role!='finance reader' AND ${actor.fence}`).bind(...actor.args).all<{id:string;display_name:string;scope:string}>()).results:[]
  const view=await serviceRead(request,env,actor),service=id?view.services.find(s=>s.id===id):undefined
  if(id&&!service)fail('service_not_found',404)
  if(request.method==='GET'){
   const members=candidates.filter(m=>service&&scopeWithin({services:[service.service],environments:[service.environment],teams:[service.team]},JSON.parse(m.scope)))
   return html?servicesPage(view,id,config,owner,members):json(id?{...service,coverage:view.coverage,edges:view.edges.filter(e=>e.from===id||e.to===id),names:view.names,snapshot:view.snapshot,from:view.from,through:view.through,budget:view.budget,backend:view.backend}:view)
  }
  const data=await input(request)
  if(Object.keys(data).some(k=>!['revision','ownerRef','runbook','repository','criticality','confirm'].includes(k)))fail('invalid_service_metadata',400)
  if(data.confirm!=='save-service-metadata')fail('confirmation_required',400)
  const revision=Number(data.revision)
  if(!Number.isSafeInteger(revision)||revision!==(service!.metadata?.revision??0))fail('service_revision_changed',409)
  const ownerRef=data.ownerRef===''?null:data.ownerRef
  if(ownerRef!==null&&(typeof ownerRef!=='string'||!/^[a-f0-9-]{36}$/.test(ownerRef)))fail('invalid_service_owner',400)
  const wanted={services:[service!.service],environments:[service!.environment],teams:[service!.team]}
  if(ownerRef){
   const member=await memberFor(env.DB,ownerRef),active=await env.DB.prepare("SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=?)").bind(ownerRef,ownerRef).first()
   if(!active||!member||member.role==='finance reader'||!scopeWithin(wanted,member.scope))fail('service_owner_scope_forbidden')
  }
  const criticality=String(data.criticality)
  if(!['unclassified','low','medium','high','critical'].includes(criticality))fail('invalid_service_criticality',400)
  const runbook=safeLink(data.runbook),repository=safeLink(data.repository),proof=proofFence(actor),now=Date.now()
  // Eligibility is tested in the same transaction as the revision insert.
  const eligible=`(? IS NULL OR EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=? AND o.status='active' AND m.role!='finance reader' AND o.role=CASE WHEN m.role IN ('owner','admin') THEN m.role ELSE 'member' END AND NOT EXISTS(SELECT 1 FROM porthole_erased_actors WHERE actor_ref=o.id) AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.services') WHERE value='*' OR value=?) AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.environments') WHERE value='*' OR value=?) AND EXISTS(SELECT 1 FROM json_each(m.scope,'$.teams') WHERE value='*' OR value=?)))`
  const saved=await env.DB.prepare(`INSERT INTO porthole_service_versions SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${actor.fence} AND ${proof.sql} AND COALESCE((SELECT MAX(revision) FROM porthole_service_versions WHERE id=?),0)=? AND ${eligible}`)
   .bind(id,service!.service,service!.environment,service!.team,revision+1,ownerRef,repository,runbook,criticality,actor.member.operatorId,now,'active',...actor.args,...proof.args,id,revision,ownerRef,ownerRef,service!.service,service!.environment,service!.team).run()
  if(!saved.meta.changes)fail('service_revision_or_authority_changed',409)
  return html?new Response(null,{status:303,headers:{...privateHeaders,location:settings+'/'+id}}):json({id,revision:revision+1,ownerRef,repository,runbook,criticality,state:'active'},201)
 }catch(error){const known=error instanceof AuthError||error instanceof IntakeError,status=known?error.status:503,code=known?error.code:'services_unavailable';return html?servicesPage(undefined,undefined,false,false,[],code,status):json({error:code},status)}
}
