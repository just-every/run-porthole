import type {ReadPrincipal} from '../security/agent-read'
import type { Bindings } from '../../auth.server'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { CredentialLimit } from '../credentials/verify'
import { privateHeaders } from '../document'
import { authority, fail } from '../security/authority'
import { collection, configurationRoot, entityTag, representation } from './model'
import { readDefinitions } from './read'
import { writeDefinition } from './write'
import { openapi } from './openapi'

const json=(value:unknown,status=200,headers:Record<string,string>={})=>Response.json(value,{status,headers:{...privateHeaders,...headers}})
export async function apiResponse(request:Request,env:Bindings,principal?:ReadPrincipal):Promise<Response|null> {
 const url=new URL(request.url),spec=url.pathname==='/api/porthole/v1/openapi.json'
 if(!spec && url.pathname!==configurationRoot && !url.pathname.startsWith(configurationRoot+'/'))return null
 const requestId=crypto.randomUUID()
 try {
  if(spec) {
   await authority(request,env)
   if(request.method!=='GET')fail('method_not_allowed',405)
   if(url.search)fail('invalid_query',400)
   return json(openapi)
  }
  const parts=url.pathname.slice(configurationRoot.length+1).split('/'),kind=collection(parts[0]),id=parts[1]
  if(parts.length>2 || id!==undefined && !/^[a-f0-9-]{36}$/.test(id))fail('configuration_not_found',404)
  if(request.method==='GET') {
   if([...url.searchParams].some(([key])=>!['limit','cursor'].includes(key)) || [...url.searchParams.keys()].some(key=>url.searchParams.getAll(key).length>1) || id && url.search)fail('invalid_query',400)
   const limit=Number(url.searchParams.get('limit')??50),cursor=url.searchParams.get('cursor')??''
   if(!Number.isSafeInteger(limit) || limit<1 || limit>200 || cursor && !/^[a-f0-9-]{36}$/.test(cursor))fail('invalid_pagination',400)
   const result=await readDefinitions(request,env,{kind,id,limit,cursor},principal),headers={'x-porthole-actor':result.actorRef,'x-porthole-actor-revision':String(result.actorRevision)}
   if(id)return json(representation(result.rows[0]),200,{...headers,etag:entityTag(result.rows[0].revision),'x-porthole-entity':id})
   return json({objects:result.rows.slice(0,limit).map(representation),cursor:result.rows.length>limit?result.rows[limit-1].id:null},200,headers)
  }
  if(principal)fail('tool_forbidden')
  if(url.search)fail('invalid_query',400)
  if(!(request.method==='POST'&&!id || ['PUT','DELETE'].includes(request.method)&&id))fail('method_not_allowed',405)
  const result=await writeDefinition(request,env,kind,id)
  return json(result.value,result.status,{etag:entityTag(result.value.revision),'idempotency-replayed':String(result.replayed),'x-porthole-entity':result.value.id,'x-porthole-actor':result.actor.member.operatorId,'x-porthole-actor-revision':String(result.actor.member.revision),...(request.method==='POST'?{location:`${configurationRoot}/${kind}/${result.value.id}`}:{})})
 } catch(error) {
  const known=error instanceof AuthError || error instanceof CredentialLimit
  const status=known?error.status:error instanceof SyntaxError?400:503,code=known?error.code:status===400?'invalid_definition':'configuration_unavailable'
  return json({error:code,details:{code,status,requestId}},status,error instanceof CredentialLimit?{'retry-after':String(error.retryAfter)}:{})
 }
}
