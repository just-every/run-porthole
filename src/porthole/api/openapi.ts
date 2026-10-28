import {monitorPaths,monitorCountSchema} from '../monitors/openapi'
import {dashboardPaths} from '../dashboards/openapi'
const response=(description:string,schema:unknown)=>({description,content:{'application/json':{schema}}})
const definition={$ref:'#/components/schemas/Definition'}
const failures=Object.fromEntries([400,401,403,404,409,412,428,429,503].map(status=>[status,response('Structured refusal',{$ref:'#/components/schemas/Error'})]))
const mutations={parameters:[{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:120}}],requestBody:{required:true,content:{'application/json':{schema:{$ref:'#/components/schemas/Input'}}}}}
/** The published document describes implemented doors only. Other product
 * domains must add their own storage and authorization before joining it. */
export const openapi={
 openapi:'3.1.0',info:{title:'Porthole configuration API',version:'1.0.0'},
 paths:{...dashboardPaths,...monitorPaths,...Object.fromEntries(['monitors','repairs'].flatMap(kind=>[
  [`/api/porthole/v1/configuration/${kind}`,{
   get:{summary:`List ${kind} within live scope`,parameters:[{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200}},{name:'cursor',in:'query',schema:{type:'string'}}],responses:{200:response('Scoped page',{type:'object',properties:{objects:{type:'array',items:definition},cursor:{type:['string','null']}}}),...failures}},
   post:{summary:'Create an inactive definition with a native session',...mutations,responses:{201:response('Created definition',definition),...failures}},
  }],
  [`/api/porthole/v1/configuration/${kind}/{id}`,{
   parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],
   get:{summary:'Read current definition and ETag',responses:{200:response('Current definition',definition),...failures}},
   delete:{summary:'Archive an exact definition revision without deleting its history',parameters:[...mutations.parameters,{name:'If-Match',in:'header',required:true,schema:{type:'string'}}],responses:{200:response('Archived definition',definition),...failures}},
   put:{summary:'Replace definition if revision still matches',...mutations,parameters:[...mutations.parameters,{name:'If-Match',in:'header',required:true,schema:{type:'string'}}],responses:{200:response('Updated inactive definition',definition),...failures}},
  }],
 ]))},
 components:{schemas:{
  MonitorCountBody:monitorCountSchema,
  Input:{type:'object',additionalProperties:false,required:['name','scope','body'],properties:{name:{type:'string',maxLength:120},scope:{$ref:'#/components/schemas/Scope'},body:{type:'object'}}},
  Definition:{type:'object',required:['id','kind','name','scope','body','revision','state'],properties:{id:{type:'string',format:'uuid'},kind:{enum:['monitor','repair']},name:{type:'string'},scope:{$ref:'#/components/schemas/Scope'},body:{type:'object'},revision:{type:'integer',minimum:1},state:{type:'string'},created_at:{type:'integer'},updated_at:{type:'integer'}}},
  Scope:{type:'object',additionalProperties:false,required:['services','environments','teams'],properties:Object.fromEntries(['services','environments','teams'].map(key=>[key,{type:'array',items:{type:'string'}}]))},
  Error:{type:'object',required:['error','details'],properties:{error:{type:'string'},details:{type:'object',properties:{code:{type:'string'},status:{type:'integer'},requestId:{type:'string'}}}}},
 }},
}
