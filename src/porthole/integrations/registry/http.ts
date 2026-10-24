import type { Bindings } from '../../../auth.server'
import { AuthError } from '../../../modules/operator-auth/index.mjs'
import { authority, fail } from '../../security/authority'
import { operationDocument, escape, privateHeaders } from '../../document'
import { healthConfiguration } from '../../health/receipts'

const path='/app/settings/integrations'
const declarations=[
 {id:'sendgrid',name:'SendGrid',api:'Mail Send v3',endpoint:'https://api.sendgrid.com/v3/mail/send',scopes:'Mail Send permission and an authorized sender',retry:'Proven refusals retry after Retry-After. Unknown acceptance is held for owner reconciliation.'},
 {id:'resend',name:'Resend',api:'Emails HTTP API with no URL version',endpoint:'https://api.resend.com/emails',scopes:'Sending access for the approved sender domain',retry:'The frozen idempotency key is retained within a bounded 23-hour window. Changed grants and expired uncertainty are held.'},
] as const

export async function integrationRegistryResponse(request:Request,env:Bindings):Promise<Response|null> {
 if(new URL(request.url).pathname!==path)return null
 try {
  const actor=await authority(request,env)
  if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('owner_required')
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(new URL(request.url).search)fail('invalid_query',400)
  const configuration=await healthConfiguration(env.DB)
  const adapters=await Promise.all(declarations.map(async declaration=>{
   const success=await env.DB.prepare(`SELECT MAX(json_extract(a.entry,'$.occurredAt')) AS at FROM porthole_audit_entries a JOIN porthole_health_notices n ON n.id=json_extract(a.entry,'$.entityRef') WHERE json_extract(a.entry,'$.action')='health.notice' AND json_extract(a.entry,'$.phase')='succeeded' AND n.state='accepted' AND json_extract(n.message,'$.provider')=?`).bind(declaration.id).first<{at:number|null}>()
   const selected=env.MAIL_PROVIDER===declaration.id
   return {...declaration,version:1,region:'Provider-managed; no regional custody guarantee',egress:'Approved recipient address, sender, health notice and installation link',owner:configuration.configured_by,lastSuccess:success?.at??null,freshnessSeconds:configuration.freshness_ms/1000,quota:'Provider account limits; durable 429 deadlines enforced',credentialStatus:selected&&env.MAIL_API_KEY?'Runtime binding present; validity requires a successful submission':'Not configured',availability:'Owner must verify provider account and sender availability before enabling delivery',nextAction:selected?'Review retained Pipeline health receipts before changing provider authority':'Configure an owner-controlled runtime binding, then explicitly approve the recipient',selected}
  }))
  if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
  const result={version:1,adapters,unavailable:[{id:'opsgenie',availability:'Existing accounts only; no Porthole adapter is implemented',nextAction:'Keep source coverage. Use a supported provider export or handoff before cutover.'}],scope:'Only the two implemented independent-mail adapters are declared here. Other named adapters remain unqualified.'}
  if(request.headers.get('accept')?.includes('application/json'))return Response.json(result,{headers:privateHeaders})
  const field=(label:string,value:unknown)=>`<dt>${label}</dt><dd>${escape(value==null?'Not recorded':String(value))}</dd>`
  return operationDocument('Integration declarations',`<p>Registry version ${result.version}. ${result.scope}</p><p>Review provider availability before enabling delivery. This page changes no grants and sends no messages.</p>${adapters.map(row=>`<section><h2>${row.name}</h2><dl class="porthole-integration-declaration">${field('Declaration version',row.version)}${field('Supported API',row.api)}${field('Region',row.region)}${field('Required scopes',row.scopes)}${field('Network destination',row.endpoint)}${field('Data egress',row.egress)}${field('Accountable owner reference',row.owner)}${field('Last successful submission',row.lastSuccess==null?null:new Date(row.lastSuccess).toISOString())}${field('Freshness window in seconds',row.freshnessSeconds)}${field('Quota',row.quota)}${field('Credential status',row.credentialStatus)}${field('Provider availability',row.availability)}${field('Retry and uncertainty',row.retry)}${field('Next action',row.nextAction)}</dl></section>`).join('')}<h2>Unavailable adapters</h2><p>Opsgenie: ${result.unavailable[0].availability}. ${result.unavailable[0].nextAction}</p><p><a href="/app/health">Review health receipts and recipient configuration</a></p>`)
 } catch(error) {
  const code=error instanceof AuthError?error.code:'integration_registry_unavailable',status=error instanceof AuthError?error.status:503
  return Response.json({error:code},{status,headers:privateHeaders})
 }
}
