import { type Bindings } from '../../auth.server'
import { createAgentDoor, type Trust } from '../../modules/agent-door/index.ts'
import { businessSettings } from './business'
import { sameOrigin } from '../security/authority'
import { privateHeaders } from '../document'
import { AuthError } from '../../modules/operator-auth/index.mjs'
import { verifyCredential, verifyCredentialId } from '../credentials/verify'
import { readTools } from './tools'
import { people } from './people'

export const capabilities=['tools','policy','pause','audit','idempotency'] as const
export function agentTrust(env:Bindings):Trust|null {
 const {RER_OWNER_CLAIM_ISSUER:issuer,RER_OWNER_CLAIM_INSTALLATION_ID:installationId,RER_OWNER_CLAIM_PUBLIC_KEYS:publicKeys}=env
 if(!issuer&&!installationId&&!publicKeys)return null
 if(!issuer||!installationId||!publicKeys)throw Error('Incomplete agent trust configuration')
 return {issuer,installationId,appOrigin:env.AUTH_ORIGIN,publicKeys:JSON.parse(publicKeys)}
}
export const notTools=[{clauses:['PORT-031'],reason:'installation' as const},{clauses:['PORT-039'],reason:'import-door' as const},{clauses:['PORT-032','PORT-036'],reason:'screen' as const},{clauses:['PORT-001','PORT-062'],reason:'connector' as const}]
export function portholeAgentDoor(env:Bindings) {
 return createAgentDoor({seed:'porthole',name:'Porthole',specialist:'observability',origin:env.AUTH_ORIGIN,db:env.DB,trust:agentTrust(env),capabilities:[...capabilities],
  people:people(env),tools:readTools(env),resources:[],notTools,paths:['/api/porthole/v1/mcp'],
  async localCredentials(request) {
   sameOrigin(request,env)
   if(!request.headers.get('authorization')?.startsWith('Bearer ph_'))return null
   const {credential}=await verifyCredential(request,env,{inspectOnly:true})
   const scopes=credential.scope.actions.filter(action=>['telemetry.read','definitions.read'].includes(action))
   if(!scopes.length)return null
   return {sponsor:{id:credential.custodianId},clientId:'native:'+credential.id,agent:{id:'native:'+credential.id,name:credential.name,specialist:'observability'},scopes}
  },
  async currentScopes(who) {
   if(!who.clientId?.startsWith('native:'))return [...who.scopes]
   try {
    const {credential}=await verifyCredentialId(new Request(env.AUTH_ORIGIN+'/mcp'),env,who.clientId.slice(7),who.person.id,{inspectOnly:true})
    return credential.scope.actions.filter(action=>['telemetry.read','definitions.read'].includes(action))
   }catch{return []}
  },
 })
}
export async function agentResponse(request:Request,env:Bindings):Promise<Response|null> {
 const path=new URL(request.url).pathname
 if(path==='/api/rer/business-settings'||path==='/rer-business-logo') {
  const settings=businessSettings(env)
  return settings.handle(request)
 }
 if(path!=='/mcp'&&path!=='/api/porthole/v1/mcp'&&path!=='/api/rer/agent-policy'&&!path.startsWith('/agents')&&!path.startsWith('/.well-known/oauth-protected-resource'))return null
 try {sameOrigin(request,env)}catch(error){return Response.json({code:error instanceof AuthError?error.code:'invalid_origin'},{status:403,headers:privateHeaders})}
 const response=await portholeAgentDoor(env).handle(request)
 // Native credentials keep the existing transport quota contract while the
 // shared door still performs policy, live metering and durable attribution.
 if(response?.status===200&&(path==='/mcp'||path==='/api/porthole/v1/mcp')&&request.headers.get('authorization')?.startsWith('Bearer ph_')) {
  const body=await response.clone().json() as {jsonrpc:string;id:unknown;result?:{_meta?:Record<string,unknown>}}
  const refusal=body.result?._meta?.['com.runeditrun/error'] as {code?:string;retryAfter?:number}|undefined
  if(refusal?.code==='credential_quota_exceeded'&&Number.isSafeInteger(refusal.retryAfter)&&refusal.retryAfter!>0) {
   return Response.json({jsonrpc:body.jsonrpc,id:body.id,error:{code:-32000,message:refusal.code,data:refusal}},{status:429,headers:{...privateHeaders,'retry-after':String(refusal.retryAfter)}})
  }
 }
 if(response)for(const [name,value]of Object.entries(privateHeaders))response.headers.set(name,value)
 return response
}
