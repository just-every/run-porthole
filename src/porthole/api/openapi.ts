import {dashboardPaths} from '../dashboards/openapi'
import {failures,json,nativeSecurity,originIntent,readSecurity,ref,scopeSchema,errorSchema} from './openapi-common'
import {intakePaths} from './openapi-intake'
import {queryPaths,querySchemas} from './openapi-query'

const definition=ref('Definition')
const mutationHeaders=[originIntent,{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',pattern:'^[A-Za-z0-9._:-]{8,120}$'}}]
const revisionHeader={name:'If-Match',in:'header',required:true,description:'Exact quoted revision ETag returned by GET.',schema:{type:'string',pattern:'^"[1-9][0-9]*"$'}}
const refused=failures([400,401,403,404,405,409,412,413,415,428,429,503])
const hostBody={type:'object',additionalProperties:false,required:['type','signal','hosts','missedAfterSeconds','pendingSeconds','recoverySeconds'],properties:{type:{const:'host-heartbeat'},signal:{enum:['logs','metrics','traces','profiles']},hosts:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'}},missedAfterSeconds:{type:'integer',minimum:1,maximum:86400},pendingSeconds:{type:'integer',minimum:0,maximum:86400},recoverySeconds:{type:'integer',minimum:0,maximum:86400}}}
const bodies={
 monitors:{oneOf:[hostBody,{type:'object',additionalProperties:false,required:['signal','operator','threshold','windowSeconds'],properties:{signal:{enum:['logs','metrics','traces']},operator:{enum:['above','below']},threshold:{type:'number'},windowSeconds:{type:'integer',minimum:1,maximum:86400}}}]},
 repairs:{type:'object',additionalProperties:false,required:['steps','expiresAt'],properties:{expiresAt:{type:'integer'},steps:{type:'array',minItems:1,maxItems:20,items:{type:'object',additionalProperties:false,required:['kind','target','revision'],properties:{kind:{enum:['restart','rollback']},target:{type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$'},revision:{type:'string',pattern:'^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$'}}}}}},
}
const configurationPaths=Object.fromEntries((['monitors','repairs'] as const).flatMap(kind=>{
 const input={type:'object',additionalProperties:false,required:['name','scope','body'],properties:{name:{type:'string',minLength:1,maxLength:120},scope:ref('Scope'),body:bodies[kind]}}
 const mutation={security:nativeSecurity,parameters:mutationHeaders,requestBody:{required:true,description:'JSON object, at most 8192 bytes. Scope requires nonempty services and environments within current grants.',content:{'application/json':{schema:input}}}}
 const success=(description:string)=>({...json(description,definition),headers:{ETag:{schema:{type:'string'},description:'Quoted current revision.'},'idempotency-replayed':{schema:{type:'boolean'}}}})
 return [
  [`/api/porthole/v1/configuration/${kind}`,{
   get:{summary:`List scoped ${kind}`,security:readSecurity,description:'Bearer credentials require definitions.read. Monitors also require their signal grant. No unknown or repeated query parameters.',parameters:[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200,default:50}},{name:'cursor',in:'query',schema:{type:'string',format:'uuid'}}],responses:{200:json('Scoped page',{type:'object',required:['objects','cursor'],properties:{objects:{type:'array',items:definition},cursor:{type:['string','null']}}}),...refused}},
   post:{summary:'Create an inactive definition',...mutation,responses:{201:success('Created definition'),...refused}},
  }],
  [`/api/porthole/v1/configuration/${kind}/{id}`,{
   parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],
   get:{summary:'Read definition and revision ETag',security:readSecurity,responses:{200:success('Current definition'),...refused}},
   put:{summary:'Replace an exact revision with an inactive definition',...mutation,parameters:[...mutationHeaders,revisionHeader],responses:{200:success('Updated definition'),...refused}},
   delete:{summary:'Archive an exact revision while retaining history',security:nativeSecurity,parameters:[...mutationHeaders,revisionHeader],responses:{200:success('Archived definition'),...refused}},
  }],
 ]
}))
// Keep the dashboard schema authored with its implementation; add shared security
// and transport refusals here without changing the native dashboard handlers.
const securedDashboardPaths=Object.fromEntries(Object.entries(dashboardPaths).map(([path,item])=>[path,Object.fromEntries(Object.entries(item).map(([method,operation])=>{
 if(method!=='get'&&method!=='post')return [method,operation]
 const op=operation as Record<string,unknown>
 return [method,{...op,security:method==='get'?readSecurity:nativeSecurity,...(method==='post'?{parameters:[originIntent,...(op.parameters as unknown[]??[])],description:`${op.description??''} Native writes require owner, admin or maintainer role and a same-origin Origin header. JSON bodies are limited to 8192 bytes.`}:{}),responses:{...(op.responses as object),...failures([400,401,403,404,405,409,413,415,429,503])}}]
}))]))

/** Static route contract only: no runtime bindings, settings or stored data. */
export const openapi={
 openapi:'3.1.0',info:{title:'Porthole implemented HTTP API',version:'1.0.0',description:'Implemented OTLP intake, bounded telemetry queries, configuration definitions and dashboards. Native session security uses the installation session cookie; development cookie names vary by local origin. All requests remain subject to configured origin checks and current scope. This document contains no installation settings. It does not advertise complete vendor language or transport compatibility.'},
 paths:{...intakePaths,...queryPaths,...configurationPaths,...securedDashboardPaths,
  '/api/porthole/v1/genai':{get:{summary:'Read scoped GenAI metadata and observed usage',security:readSecurity,description:'Current trace authority, snapshot and paging rules apply. Identical span copies do not add usage. Missing token counters, USD, rate source and authorized provider reconciliation stay unavailable. Content capture is disabled.',parameters:['trace','service','environment','team','from','through','cursor','snapshot'].map(name=>({name,in:'query',schema:{type:'string'}})),responses:{200:json('Observed GenAI calls and provider, model and feature groups for this page',{type:'object'}),...failures([400,401,403,405,409,429,503])}}},
  '/api/porthole/v1/openapi.json':{get:{summary:'Read this contract through the protected API',security:nativeSecurity,responses:{200:json('OpenAPI document',{type:'object'}),...failures([400,401,403,405,409,503])}}},
 },
 components:{securitySchemes:{
  ScopedCredential:{type:'http',scheme:'bearer',description:'Porthole scoped credential in Authorization. Intake requires telemetry.write; queries require telemetry.read; definition reads require definitions.read. Signal and resource grants, live custody and limits apply. Credentials in URL query parameters are forbidden.'},
  NativeSession:{type:'apiKey',in:'cookie',name:'__Host-operator_session',description:'Native installation session. Local development uses an origin-specific cookie name. Native mutation roles are owner, admin or maintainer; unsafe requests require a same-origin Origin header. Authorization credentials cannot mutate definitions.'},
 },schemas:{...querySchemas,Scope:scopeSchema,Error:errorSchema,
  Definition:{type:'object',required:['id','kind','name','scope','body','revision','state'],properties:{id:{type:'string',format:'uuid'},kind:{enum:['monitor','repair']},name:{type:'string'},scope:ref('Scope'),body:{oneOf:[bodies.monitors,bodies.repairs]},revision:{type:'integer',minimum:1},state:{enum:['inactive','active','approved','archived','quarantined']},created_at:{type:'integer'},updated_at:{type:'integer'}}},
 }},
}
