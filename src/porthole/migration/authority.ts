import type {Bindings} from '../../auth.server'
import type {D1Sql} from '../../modules/import-kit/src/d1/types.ts'
import {authority,fail,proofFence} from '../security/authority'
export async function migrationOwner(request:Request,env:Bindings){
 const actor=await authority(request,env,{manage:true,post:request.method==='POST',stepUp:request.method==='POST'})
 if(actor.member.role!=='owner')fail('owner_required')
 const proof=request.method==='POST'?proofFence(actor):{sql:'1',args:[]}
 return {sql:`(${actor.fence}) AND (${proof.sql}) AND EXISTS(SELECT 1 FROM porthole_members WHERE operator_id=? AND role='owner')`,params:[...actor.args,...proof.args,actor.member.operatorId],email:actor.session.operator.email} satisfies D1Sql & {email:string}
}
