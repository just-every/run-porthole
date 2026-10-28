import type {Bindings} from '../../auth.server'
import {allScope,authority,emptyScope,fail} from '../security/authority'
import {verifyCredential} from '../credentials/verify'
export async function queryActor(request:Request,env:Bindings) {
 if(request.headers.has('authorization')){
  const auth=await verifyCredential(request,env,{action:'telemetry.read',scope:emptyScope,dataScope:allScope,inspectOnly:true})
  return {id:auth.credential.id,revision:auth.credential.revision,fence:auth.fence.sql,args:auth.fence.args,scope:auth.credential.scope,signals:auth.credential.scope.signals}
 }
 const actor=await authority(request,env,{post:request.method==='POST'})
 if(!['owner','admin','maintainer','responder','read-only analyst','restricted contractor'].includes(actor.member.role))fail('telemetry_forbidden')
 return {id:actor.member.operatorId,revision:actor.member.revision,fence:actor.fence,args:actor.args,scope:actor.member.scope,signals:['logs','metrics','traces','profiles']}
}
