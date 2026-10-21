import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { authority,fail } from '../security/authority'
import { input } from '../security/input'
import { readTelemetry } from '../ingest/read'
import { operationDocument as document,escape,privateHeaders } from '../document'
const keys=['signal','service','environment','team','from','through','cursor','limit','snapshot']
function queryRequest(request:Request,data:Record<string,unknown>):Request {
 const url=new URL('/api/porthole/v1/ingest/records',request.url)
 for(const [key,value] of Object.entries(data)) {
  if(!keys.includes(key) || !['string','number'].includes(typeof value))fail('invalid_query',400)
  url.searchParams.set(key,String(value))
 }
 return new Request(url,{headers:request.headers})
}
export async function queryResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname==='/app/explore'
 if(!page && url.pathname!=='/api/porthole/v1/query' && !/^\/api\/porthole\/v1\/query\/[a-f0-9-]{36}$/.test(url.pathname))return null
 try {
  await authority(request,env,{post:request.method==='POST'})
  if(page && request.method==='GET') return document('Explore telemetry',`<p>Read retained telemetry within your current service, environment and team scope. Each query has a reproducible, private snapshot reference in Audit.</p><form method="post" action="/app/explore"><label>Signal <select name="signal" aria-label="Signal"><option>logs</option><option>metrics</option><option>traces</option></select></label><label>Service <input name="service" required></label><label>Environment <input name="environment" required></label><label>Team <input name="team" required></label><button>Run query</button></form>`,200,{forms:true})
  let data:Record<string,unknown>
  const id=url.pathname.split('/').at(-1)!
  if(request.method==='GET' && id!=='query') {
   const previous=await env.DB.prepare('SELECT * FROM porthole_query_snapshots WHERE id=?').bind(id).first<{scope:string;signal:string;from_ns:string;through_ns:string;through_batch:number}>()
   if(!previous)fail('query_not_found',404)
   data={...JSON.parse(previous.scope),signal:previous.signal,snapshot:previous.through_batch}
   if(previous.from_ns)data.from=previous.from_ns
   if(previous.through_ns)data.through=previous.through_ns
  } else {
   if(request.method!=='POST')fail('method_not_allowed',405)
   data=await input(request)
  }
  const response=await readTelemetry(queryRequest(request,data),env)
  if(!response.ok) {if(!page)return response;const error=await response.json() as {error:string};return document('Query unavailable',`<p role="alert">${escape(error.error)}</p><p><a href="/app/explore">Return to Explore</a></p>`,response.status)}
  const result=await response.json() as Record<string,unknown>,reference=String(result.queryRef)
  const headers={...privateHeaders,'x-porthole-entity':reference}
  if(page) {const view=await document('Query results',`<p>Snapshot reference: ${reference}</p><p><a href="/api/porthole/v1/query/${reference}">Repeat this snapshot</a> · <a href="/app/explore">New query</a></p><pre>${escape(JSON.stringify(result,null,2))}</pre>`);view.headers.set('x-porthole-entity',reference);return view}
  return Response.json({...result,queryRef:reference,replay:`/api/porthole/v1/query/${reference}`},{headers})
 }catch(error) {
  const code=error instanceof AuthError?error.code:'query_unavailable',status=error instanceof AuthError?error.status:503
  return page?document('Query unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="/app/explore">Return to Explore</a></p>`,status,{forms:true}):Response.json({error:code},{status,headers:privateHeaders})
 }
}
