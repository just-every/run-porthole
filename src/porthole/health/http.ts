import type { Bindings } from '../../auth.server'
import { operatorAuth } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { document, escape, privateHeaders } from '../document'
import { authority, fail, sameOrigin } from '../security/authority'
import { CredentialLimit } from '../credentials/verify'
import { observeHealth } from './observe'
import { configureHealth } from './configuration'
import { collectorHeartbeat } from './heartbeat'
import { healthPage } from './page'
import { healthTick } from './tick'
import { noticeSummary } from '../recovery/notices'
import type { HealthBindings } from './model'
export { healthTick, recordComponentReceipt } from './tick'
const paths=new Set(['/app/health','/api/v1/health','/app/health/configuration','/api/v1/health/configuration','/api/v1/health/heartbeat','/app/health/tick','/api/v1/health/tick'])
const json=(value:unknown,status=200,extra:Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...extra}})

export async function healthResponse(request:Request, bindings:Bindings):Promise<Response|null> {
 const env=bindings as HealthBindings,url=new URL(request.url),page=url.pathname.startsWith('/app/')
 if (!paths.has(url.pathname)) return null
 try {
  sameOrigin(request,env)
  if (url.search) fail('invalid_health_query',400)
  if (url.pathname==='/api/v1/health/heartbeat') return json(await collectorHeartbeat(request,env))
  if (request.method==='POST') {
   sameOrigin(request,env,true)
   if (url.pathname.endsWith('/configuration')) {
    const config=await configureHealth(request,env)
    return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/health'}}):json({revision:config.revision,noticesEnabled:config.notices_enabled===1,freshnessSeconds:config.freshness_ms/1000,recipient:config.recipient})
   }
   if (url.pathname.endsWith('/tick')) {
    const actor=await authority(request,env,{post:true})
    if (actor.member.role!=='owner') fail('owner_required')
    const result=await healthTick(env)
    return page?new Response(null,{status:303,headers:{...privateHeaders,location:'/app/health'}}):json(result)
   }
  }
  if (request.method!=='GET' || !['/app/health','/api/v1/health'].includes(url.pathname)) fail('method_not_allowed',405)
  const session=await operatorAuth(env).getSession(request)
  if (!session) fail('authentication_required',401)
  if (session.operator.role!=='owner') fail('owner_required')
  const state=await observeHealth(env), notices=await noticeSummary(env.DB)
  return page?healthPage(state,notices):json({...state,notices})
 } catch(error) {
  const code=error instanceof AuthError || error instanceof CredentialLimit?error.code:'control_plane_unavailable'
  const status=error instanceof AuthError || error instanceof CredentialLimit?error.status:503
  const messages:Record<string,string>={authentication_required:'Sign in as the installation owner to read pipeline health.',unauthenticated:'Sign in as the installation owner to read pipeline health.',owner_required:'Only the installation owner can read pipeline health.',step_up_required:'Verify your identity, then save this configuration within five minutes.',control_plane_unavailable:'The control plane could not be read. Follow the owner recovery procedure before resuming work.'}
  const extra:Record<string,string>=error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{}
  return page?document('Pipeline health unavailable',`<p role="alert">${escape(messages[code]??code.replaceAll('_',' '))}</p><p><a href="/app/health">Return to pipeline health</a></p>`,status,{forms:true}):json({error:code},status,extra)
 }
}
