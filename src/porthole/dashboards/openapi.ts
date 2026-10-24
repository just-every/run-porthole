import {widgetKinds} from './widgets/kinds'
const json=(description:string,schema:unknown)=>({description,content:{'application/json':{schema}}})
const scope={$ref:'#/components/schemas/Scope'}
const body={type:'object',additionalProperties:false,required:['panels','variables','range','annotations'],properties:{
 panels:{type:'array',maxItems:30,items:{type:'object',additionalProperties:false,required:['id','title','service','signal','aggregate','unit'],properties:{id:{type:'string'},title:{type:'string',maxLength:120},service:{type:'string'},signal:{enum:['metrics','logs','traces']},aggregate:{enum:['average','count','p95']},metric:{type:'string',description:'Required for metrics; exact metric name'},unit:{type:'string',maxLength:32},compareWeek:{type:'boolean'},widget:{enum:widgetKinds},note:{type:'string',maxLength:5000}}}},
 variables:{type:'object',required:['team','environment'],properties:{team:{type:'string'},environment:{type:'string'}}},
 range:{type:'object',required:['from','through'],properties:{from:{type:'string',pattern:'^[0-9]+$'},through:{type:'string',pattern:'^[0-9]+$'}}},
 annotations:{type:'array',maxItems:100,items:{type:'object',required:['at','label'],properties:{at:{type:'string'},label:{type:'string',maxLength:300}}}},
}}
const input={type:'object',additionalProperties:false,required:['name','scope','body'],properties:{id:{type:'string',format:'uuid'},revision:{type:'integer',minimum:1},name:{type:'string',maxLength:120},scope,body}}
const dashboard={...input,required:['id','revision','name','scope','body','state'],properties:{...input.properties,state:{enum:['active','archived','quarantined']},versions:{type:'array',items:{type:'integer'}}}}
const receipt={type:'object',required:['id','revision','state'],properties:{id:{type:'string',format:'uuid'},revision:{type:'integer'},state:{type:'string'}}}
const error=json('Structured refusal; rate limits include Retry-After',{type:'object',required:['error'],properties:{error:{type:'string'}}})
const failures=Object.fromEntries([400,401,403,404,409,413,429,503].map(status=>[status,error]))
const write={summary:'Create or replace a dashboard using a native session',description:'Updates require id and the exact current revision in the body. A scoped read credential cannot mutate. Idempotency-Key is optional and makes repeated identical native writes durable.',parameters:[{in:'header',name:'Idempotency-Key',schema:{type:'string',minLength:8,maxLength:120}}],requestBody:{required:true,content:{'application/json':{schema:input}}},responses:{201:json('Committed revision',receipt),...failures}}
export const dashboardPaths={
 '/api/porthole/v1/dashboards':{
  get:{summary:'List whole dashboard definitions within current scope and signal grants',parameters:[{in:'query',name:'limit',schema:{type:'integer',minimum:1,maximum:200}},{in:'query',name:'cursor',schema:{type:'string',format:'uuid'}}],responses:{200:json('Scoped page',{type:'object',properties:{objects:{type:'array',items:dashboard},cursor:{type:['string','null']}}}),...failures}},post:write,
 },
 '/api/porthole/v1/dashboards/{id}':{parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],get:{summary:'Read current or historical dashboard with ETag',parameters:[{in:'query',name:'version',schema:{type:'integer',minimum:1}}],responses:{200:json('Authorized definition and visible revision numbers',dashboard),...failures}}},
 '/api/porthole/v1/dashboards/archive':{post:{...write,summary:'Archive an exact dashboard revision, retaining history',requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['id','revision'],properties:{id:input.properties.id,revision:input.properties.revision}}}}}}},
}
