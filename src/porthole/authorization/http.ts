import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,memberFor,proofFence,scopeWithin,type Authority} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
import {settingsNav} from '../membership/page'
import {currentDashboard} from '../dashboards/store'
import {nativeRelease} from './dashboard-policy'
import {digest} from '../audit/store'

const root='/app/settings/dashboard-access'
interface Entry {operatorId:string;memberRevision:number;access:'viewer'|'editor'}
interface Policy {dashboard_id:string;revision:number;entries:string;state:string;updated_at:number}
interface Review {id:string;dashboard_id:string;dashboard_revision:number;policy_revision:number;actor_id:string;actor_revision:number;operator_version:number;session_id:string;entries:string;digest:string;expires_at:number;consumed_at:number|null}
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:privateHeaders})
const positive=(value:unknown,zero=false)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<(zero?0:1))fail('invalid_revision',400);return n}
async function policy(env:Bindings,id:string) {return env.DB.prepare('SELECT * FROM porthole_dashboard_policies WHERE dashboard_id=?').bind(id).first<Policy>()}
async function entries(env:Bindings,value:unknown,scope:Parameters<typeof scopeWithin>[0]) {
 const rows=typeof value==='string'?JSON.parse(value):value
 if(!Array.isArray(rows)||rows.length>100)fail('invalid_dashboard_policy',400)
 const result:Entry[]=[]
 for(const row of rows) {
  if(!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='access,memberRevision,operatorId'||!['viewer','editor'].includes(row.access)||typeof row.operatorId!=='string'||!/^[a-f0-9-]{36}$/.test(row.operatorId)||result.some(entry=>entry.operatorId===row.operatorId))fail('invalid_dashboard_policy',400)
  const member=await memberFor(env.DB,row.operatorId)
  const operator=await env.DB.prepare("SELECT id FROM oa_operators WHERE id=? AND status='active' AND role='member'").bind(row.operatorId).first()
  if(!member||!operator||member.role!=='maintainer'||member.revision!==positive(row.memberRevision)||!scopeWithin(scope,member.scope))fail('ineligible_policy_member')
  result.push({operatorId:member.operatorId,memberRevision:member.revision,access:row.access})
 }
 return result.sort((a,b)=>a.operatorId.localeCompare(b.operatorId))
}
const hidden=(name:string,value:string|number)=>`<input type="hidden" name="${name}" value="${escape(value)}">`
const reviewPage=(review:Review)=>document('Review dashboard access',`${settingsNav}<p>This exact change only restricts existing access. Owners and admins keep their existing authority. Empty entries deny every other member.</p><pre>${escape(review.entries)}</pre><p>Dashboard revision ${review.dashboard_revision}; policy revision ${review.policy_revision}. This review expires in five minutes.</p><form method="post" action="${root}/apply">${hidden('reviewId',review.id)}${hidden('digest',review.digest)}${hidden('dashboardRevision',review.dashboard_revision)}${hidden('policyRevision',review.policy_revision)}<label><input type="checkbox" name="confirm" value="restrict-dashboard-access" required>Apply these exact restrictions</label><button>Apply reviewed restrictions</button></form>`,200,{forms:true})
async function preview(request:Request,env:Bindings,actor:Authority,data:Record<string,unknown>) {
 if(Object.keys(data).some(key=>!['dashboardId','dashboardRevision','policyRevision','entries'].includes(key)))fail('invalid_dashboard_policy',400)
 const dashboard=await currentDashboard(env,actor,String(data.dashboardId)),previous=await policy(env,dashboard.id)
 if(dashboard.state==='quarantined')fail('dashboard_inactive',409)
 if(positive(data.dashboardRevision)!==dashboard.revision||positive(data.policyRevision,true)!==(previous?.revision??0))fail('revision_or_authority_changed',409)
 const selected=await entries(env,data.entries,JSON.parse(dashboard.scope)),now=Date.now()
 const review:Review={id:crypto.randomUUID(),dashboard_id:dashboard.id,dashboard_revision:dashboard.revision,policy_revision:previous?.revision??0,actor_id:actor.member.operatorId,actor_revision:actor.member.revision,operator_version:actor.session.operator.version,session_id:actor.session.id,entries:JSON.stringify(selected),digest:'',expires_at:now+300000,consumed_at:null}
 review.digest=await digest(JSON.stringify(review))
 const proof=proofFence(actor)
 // SQLite's conditional INSERT uses SELECT, keeping review custody native.
 const statement=env.DB.prepare(`INSERT INTO porthole_dashboard_policy_reviews SELECT ?,?,?,?,?,?,?,?,?,?,?,?,NULL WHERE ${actor.fence} AND ${proof.sql}`)
  .bind(review.id,review.dashboard_id,review.dashboard_revision,review.policy_revision,review.actor_id,review.actor_revision,review.operator_version,review.session_id,review.entries,review.digest,review.expires_at,now,...actor.args,...proof.args)
 if(!(await statement.run()).meta.changes)fail('revision_or_authority_changed',409)
 return review
}
async function apply(env:Bindings,actor:Authority,data:Record<string,unknown>) {
 if(Object.keys(data).some(key=>!['reviewId','digest','dashboardRevision','policyRevision','confirm'].includes(key))||data.confirm!=='restrict-dashboard-access')fail('exact_policy_review_required',400)
 const review=await env.DB.prepare('SELECT * FROM porthole_dashboard_policy_reviews WHERE id=?').bind(String(data.reviewId)).first<Review>()
 const now=Date.now()
 if(!review||review.digest!==data.digest||review.actor_id!==actor.member.operatorId||review.actor_revision!==actor.member.revision||review.operator_version!==actor.session.operator.version||review.session_id!==actor.session.id||review.consumed_at!==null||review.expires_at<=now||positive(data.dashboardRevision)!==review.dashboard_revision||positive(data.policyRevision,true)!==review.policy_revision)fail('policy_review_changed',409)
 const dashboard=await currentDashboard(env,actor,review.dashboard_id)
 await entries(env,review.entries,JSON.parse(dashboard.scope))
 const proof=proofFence(actor)
 const allowed=`${actor.fence} AND ${proof.sql} AND EXISTS(SELECT 1 FROM porthole_dashboard_policy_reviews WHERE id=? AND consumed_at IS NULL AND expires_at>?)
 AND EXISTS(SELECT 1 FROM porthole_dashboards WHERE id=? AND revision=? AND state!='quarantined')
 AND COALESCE((SELECT revision FROM porthole_dashboard_policies WHERE dashboard_id=?),0)=?
 AND NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.operator_id=json_extract(e.value,'$.operatorId') AND m.revision=json_extract(e.value,'$.memberRevision') AND m.role='maintainer' AND o.role='member' AND o.status='active'))`
 const args=[...actor.args,...proof.args,review.id,now,dashboard.id,review.dashboard_revision,dashboard.id,review.policy_revision,review.entries]
 try {await env.DB.batch([
  env.DB.prepare(`INSERT INTO porthole_transaction_guard(singleton,witness) VALUES(1,CASE WHEN ${allowed} THEN 1 ELSE 0 END) ON CONFLICT(singleton) DO UPDATE SET witness=excluded.witness`).bind(...args),
  env.DB.prepare('UPDATE porthole_dashboard_policy_reviews SET consumed_at=? WHERE id=?').bind(now,review.id),
  env.DB.prepare(`INSERT INTO porthole_dashboard_policies VALUES(?,?,?,'active',?) ON CONFLICT(dashboard_id) DO UPDATE SET revision=excluded.revision,entries=excluded.entries,state='active',updated_at=excluded.updated_at`).bind(dashboard.id,review.policy_revision+1,review.entries,now),
  env.DB.prepare('UPDATE porthole_dashboards SET revision=revision+1,updated_at=? WHERE id=?').bind(now,dashboard.id),
 ])}catch(error) {if(String(error).includes('CHECK constraint failed'))fail('revision_or_authority_changed',409);throw error}
 await nativeRelease(env,actor,[{id:dashboard.id,revision:review.dashboard_revision+1}])
 return {id:dashboard.id,dashboardRevision:review.dashboard_revision+1,policyRevision:review.policy_revision+1}
}
export async function dashboardPolicyResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url)
 if(![root,root+'/preview',root+'/apply'].includes(url.pathname))return null
 const form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')
 try {
  const actor=await authority(request,env,{manage:true,post:request.method==='POST',stepUp:request.method==='POST'})
  if(request.method==='GET'&&url.pathname===root) {
   if([...url.searchParams.keys()].some(key=>key!=='id')||url.searchParams.getAll('id').length>1)fail('invalid_query',400)
   const id=url.searchParams.get('id')
   if(!id) {
    const rows=(await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE ${actor.fence}`).bind(...actor.args).all<{id:string;name:string;scope:string;revision:number}>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
    await nativeRelease(env,actor,rows)
    return document('Dashboard access',`${settingsNav}<p>Restrict dashboards for eligible native maintainers. These policies grant no role, credential, membership or telemetry rights.</p>${rows.map(row=>`<p><a href="${root}?id=${row.id}">${escape(row.name)}</a></p>`).join('')}`,200,{forms:true})
   }
   const dashboard=await currentDashboard(env,actor,id),current=await policy(env,id)
   const members=(await env.DB.prepare("SELECT m.operator_id,m.revision,m.scope,o.display_name FROM porthole_members m JOIN oa_operators o ON o.id=m.operator_id WHERE m.role='maintainer' AND o.role='member' AND o.status='active'").all<{operator_id:string;revision:number;scope:string;display_name:string}>()).results.filter(row=>scopeWithin(JSON.parse(dashboard.scope),JSON.parse(row.scope)))
   await nativeRelease(env,actor,[dashboard])
   return document('Dashboard access',`${settingsNav}<h2>${escape(dashboard.name)}</h2><p>Policy ${current?.revision??0} · ${escape(current?.state??'Inherited role access')}. Owners and admins retain existing authority. Entries apply only while the member revision and current scope still match.</p><h2>Eligible maintainers</h2>${members.map(row=>`<p>${escape(row.display_name)}: ${escape(row.operator_id)} · member revision ${row.revision}</p>`).join('')||'<p>No eligible maintainers.</p>'}<form method="post" action="${root}/preview">${hidden('dashboardId',id)}${hidden('dashboardRevision',dashboard.revision)}${hidden('policyRevision',current?.revision??0)}<label>Restrictions JSON<textarea name="entries" rows="10" required>${escape(current?.entries??'[]')}</textarea></label><p>Each entry uses operatorId, memberRevision and access: viewer or editor. Omitted members lose access. Empty entries keep access with owners and admins only.</p><button>Review restrictions</button></form>`,200,{forms:true})
  }
  if(request.method!=='POST')fail('method_not_allowed',405)
  const data=await input(request)
  if(url.pathname.endsWith('/preview')) {const review=await preview(request,env,actor,data);return form?reviewPage(review):json(review,201)}
  if(url.pathname.endsWith('/apply')) {const result=await apply(env,actor,data);return form?new Response(null,{status:303,headers:{...privateHeaders,location:root+'?id='+result.id}}):json(result)}
  fail('method_not_allowed',405)
 }catch(error) {
  const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_dashboard_policy':'dashboard_policy_unavailable'
  return request.method==='GET'||form?document('Dashboard access unavailable',`${settingsNav}<p role="alert">${escape(code.replaceAll('_',' '))}</p><a href="${root}">Return to dashboard access</a>`,status,{forms:true}):json({error:code},status)
 }
}
