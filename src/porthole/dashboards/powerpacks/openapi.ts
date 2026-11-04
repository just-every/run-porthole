import {dashboardBodySchema} from '../openapi'
import {failures,json,nativeSecurity,originIntent,ref} from '../../api/openapi-common'
const root='/api/porthole/v1/dashboard-powerpacks'
const refused=failures([400,401,403,404,405,409,413,415,503])
const description='Current native owner and current scope required. Bearer credentials refuse even with an owner cookie. Mutations additionally require fresh sign-in proof and same-origin Origin. JSON input is limited to 8192 bytes. Private definitions only; no new publication or delegated update authority.'
const response=json('Private native definition with JSON-encoded body and scope; detail includes immutable visible versions',{type:'object'})
const definition={type:'object',additionalProperties:false,required:['name','scope','body'],properties:{id:{type:'string',format:'uuid'},revision:{type:'integer',minimum:0},name:{type:'string',minLength:1,maxLength:120},scope:ref('Scope'),body:dashboardBodySchema}}
export const powerpackPaths={
 [root]:{get:{summary:'List native-owner powerpack definitions',description,security:nativeSecurity,responses:{200:json('Current scoped private packs',{type:'object',properties:{objects:{type:'array',items:{type:'object'}}}}),...refused}}},
 [root+'/{id}']:{parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],get:{summary:'Read a private powerpack and its version history',description,security:nativeSecurity,responses:{200:response,...refused}}},
 [root+'/preview']:{post:{summary:'Review an exact private pack and all affected consumer revisions',description,security:nativeSecurity,parameters:[originIntent],requestBody:{required:true,content:{'application/json':{schema:definition}}},responses:{201:json('Single-use five-minute review packet with id, digest, exact definition and consumers',{type:'object'}),...refused}}},
 [root+'/approve']:{post:{summary:'Atomically apply the reviewed pack and consumer revisions',description:description+' Any intervening pack or consumer revision, expired review or changed owner authority refuses without product writes. Consumer source revisions advance without publication renewal.',security:nativeSecurity,parameters:[originIntent],requestBody:{required:true,content:{'application/json':{schema:{type:'object',additionalProperties:false,required:['id','digest','confirm'],properties:{id:{type:'string',format:'uuid'},digest:{type:'string',pattern:'^[a-f0-9]{64}$'},confirm:{const:'apply-private-powerpack'}}}}}},responses:{200:response,...refused}}},
}
