import type {Bindings} from '../../../auth.server'
import {AuthError} from '../../../modules/operator-auth/index.mjs'
import {authority,fail,scopeWithin} from '../../security/authority'
import {input} from '../../security/input'
import {operationDocument as document,escape,privateHeaders} from '../../document'
import {currentPack,previewPack,reviewFor,approvePack} from './store'
import type {PowerpackRow} from './model'
import {packPage} from './page'
const api='/api/porthole/v1/dashboard-powerpacks',app='/app/settings/dashboard-powerpacks'
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:privateHeaders})
export async function powerpackResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname.startsWith(app),root=page?app:api
 if(url.pathname!==root&&!url.pathname.startsWith(root+'/'))return null
 try {
  const action=url.pathname.slice(root.length+1),post=request.method==='POST'
  if(!['GET','POST'].includes(request.method)||post&&!['preview','approve'].includes(action))fail('method_not_allowed',405)
  if([...url.searchParams.keys()].some(key=>key!=='review'||url.searchParams.getAll(key).length!==1))fail('invalid_query',400)
  const actor=await authority(request,env,{post,stepUp:post})
  if(actor.member.role!=='owner'||actor.session.operator.role!=='owner')fail('powerpack_owner_required')
  if(post) {
   const data=await input(request),row=action==='preview'?await previewPack(env,actor,data):await approvePack(env,actor,data)
   return page?new Response(null,{status:303,headers:{...privateHeaders,location:app+('packet' in row?'?review='+row.id:'/'+row.id),'x-porthole-entity':row.id}}):json(row,action==='preview'?201:200)
  }
  const selected=action?await currentPack(env,actor,action):null
  if(!page) {
   if(selected){const versions=(await env.DB.prepare(`SELECT * FROM porthole_powerpack_versions WHERE id=? AND ${actor.fence} ORDER BY revision DESC`).bind(selected.id,...actor.args).all<PowerpackRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope));return json({...selected,versions})}
   const rows=(await env.DB.prepare(`SELECT * FROM porthole_powerpacks WHERE ${actor.fence} ORDER BY name,id`).bind(...actor.args).all<PowerpackRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope));return json({objects:rows})
  }
  const rows=(await env.DB.prepare(`SELECT * FROM porthole_powerpacks WHERE ${actor.fence} ORDER BY name,id`).bind(...actor.args).all<PowerpackRow>()).results.filter(row=>scopeWithin(JSON.parse(row.scope),actor.member.scope))
  return packPage(rows,selected,url.searchParams.has('review')?await reviewFor(env,actor,url.searchParams.get('review')!):null)
 }catch(error){const status=error instanceof AuthError?error.status:error instanceof SyntaxError?400:503,code=error instanceof AuthError?error.code:status===400?'invalid_powerpack':'powerpacks_unavailable';return page?document('Powerpack unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${app}">Return to powerpacks</a></p>`,status,{forms:true}):json({error:code},status)}
}
