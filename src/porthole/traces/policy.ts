import type {Bindings} from '../../auth.server'
import {AuthError} from '../../modules/operator-auth/index.mjs'
import {authority,fail,proofFence} from '../security/authority'
import {input} from '../security/input'
import {operationDocument as document,escape,privateHeaders} from '../document'
export interface BaggagePolicy { version:1; revision:number; enabled:boolean; allowedKeys:string[]; attributeKeys:string[]; maxEntries:8; maxValueBytes:256 }
export function baggageKeys(value:unknown):string[] {
 const keys=typeof value==='string'?value.split(',').map(key=>key.trim()).filter(Boolean):value
 if(!Array.isArray(keys)||keys.length>64||keys.some(key=>typeof key!=='string'||!/^[a-z][a-z0-9_.-]{0,63}$/.test(key))||new Set(keys).size!==keys.length)fail('invalid_baggage_keys',400)
 return keys
}
export async function baggagePolicy(db:D1Database):Promise<BaggagePolicy> {
 const row=await db.prepare('SELECT * FROM porthole_baggage_policy WHERE singleton=1').first<{revision:number;enabled:number;allowed_keys:string;attribute_keys:string}>()
 if(!row)fail('baggage_policy_unavailable',503)
 return {version:1,revision:row.revision,enabled:!!row.enabled,allowedKeys:JSON.parse(row.allowed_keys),attributeKeys:JSON.parse(row.attribute_keys),maxEntries:8,maxValueBytes:256}
}
const root='/app/settings/instrumentation'
export async function baggageResponse(request:Request,env:Bindings):Promise<Response|null> {
 const url=new URL(request.url),page=url.pathname===root,download=url.pathname===root+'/policy.json'
 if(!page&&!download)return null
 const json=request.headers.get('content-type')?.startsWith('application/json')||request.headers.get('accept')?.includes('application/json')
 try {
  const actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
  if(actor.member.role!=='owner'||actor.session.kind!=='native')fail('owner_required')
  if(url.search)fail('invalid_query',400)
  let policy=await baggagePolicy(env.DB)
  if(request.method==='POST'&&page) {
   const data=await input(request)
   if(Object.keys(data).some(key=>!['revision','enabled','allowedKeys','attributeKeys','confirm'].includes(key)))fail('invalid_baggage_policy',400)
   if(data.confirm!=='apply-baggage-policy')fail('baggage_confirmation_required',400)
   const enabled=data.enabled===true||data.enabled==='true'?1:data.enabled===false||data.enabled==='false'?0:fail('invalid_baggage_policy',400)
   const allowed=baggageKeys(data.allowedKeys),attributes=baggageKeys(data.attributeKeys)
   if(attributes.some(key=>!allowed.includes(key)))fail('attribute_key_not_allowed',400)
   if(Number(data.revision)!==policy.revision)fail('baggage_policy_changed',409)
   const proof=proofFence(actor)
   const result=await env.DB.prepare(`UPDATE porthole_baggage_policy SET enabled=?,allowed_keys=?,attribute_keys=?,revision=revision+1,changed_at=? WHERE singleton=1 AND revision=? AND ${actor.fence} AND ${proof.sql} RETURNING revision`).bind(enabled,JSON.stringify(allowed),JSON.stringify(attributes),Date.now(),policy.revision,...actor.args,...proof.args).all()
   if(!result.results.length)fail('baggage_policy_changed',409)
   policy=await baggagePolicy(env.DB)
   if(json)return Response.json(policy,{headers:privateHeaders})
   return new Response(null,{status:303,headers:{...privateHeaders,location:root}})
  }
  if(request.method!=='GET')fail('method_not_allowed',405)
  if(download)return Response.json(policy,{headers:{...privateHeaders,'content-disposition':'attachment; filename="porthole-baggage-policy.json"'}})
  if(json)return Response.json(policy,{headers:privateHeaders})
  return document('Instrumentation policy',`<p role="status">Baggage ${policy.enabled?'enabled by owner':'off by default'} · revision ${policy.revision}.</p><p>Only listed keys may cross instrumented HTTP, gRPC and Kafka boundaries. At most eight entries and 256 UTF-8 bytes per decoded value. Sensitive keys matching auth, token, email, name, secret, password, cookie, credential, session, API key, address or phone are always refused, even if listed. Refusal diagnostics contain counts and reasons, never keys or values.</p><form method="post" action="${root}"><input type="hidden" name="revision" value="${policy.revision}"><label>Baggage forwarding <select name="enabled"><option value="false"${!policy.enabled?' selected':''}>Off</option><option value="true"${policy.enabled?' selected':''}>Owner allowlist</option></select></label><label>Forwarded keys (comma separated)<input name="allowedKeys" value="${escape(policy.allowedKeys.join(', '))}" maxlength="4096"></label><label>Span attribute keys (separate allowlist)<input name="attributeKeys" value="${escape(policy.attributeKeys.join(', '))}" maxlength="4096"></label><p>An empty attribute allowlist copies no baggage into spans. The runtime may support less capture; it never grants more. A missing or invalid policy file disables baggage.</p><label><input type="checkbox" name="confirm" value="apply-baggage-policy" required>I approve this exact forwarding and attribute policy.</label><p>Saving records the policy and audit receipt. Download and deploy the reviewed file to each instrumented process, then restart it. Existing processes retain their deployed revision until you replace it and restart; saving alone does not change them.</p><button>Save reviewed policy</button></form><p><a href="${root}/policy.json">Download runtime policy</a> · <a href="/app/traces">Open trace waterfall</a></p><p>Deploy as a read-only file and set PORTHOLE_BAGGAGE_POLICY to its path. Do not enable the stock baggage propagator alongside the Porthole policy propagator. Runtime refusal counts appear in structured local diagnostics; supported span diagnostics appear under Span details in the waterfall.</p>`,200,{forms:true})
 } catch(error) {
  const code=error instanceof AuthError?error.code:'baggage_policy_unavailable',status=error instanceof AuthError?error.status:503
  return json||download?Response.json({error:code},{status,headers:privateHeaders}):document('Instrumentation policy unavailable',`<p role="alert">${escape(code.replaceAll('_',' '))}</p><p><a href="${root}">Return to instrumentation policy</a></p>`,status)
 }
}
