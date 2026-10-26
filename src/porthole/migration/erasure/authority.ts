import type {Bindings} from '../../../auth.server'
import type {D1Sql} from '../../../modules/import-kit/src/d1/types.ts'
import {authority,fail} from '../../security/authority'
import {migrationOwner} from '../authority'

/** The import owner predicate alone also admits provider sessions. Privacy
 * requires an unrestricted native owner, with proof still fresh at commit. */
export async function erasureOwner(request:Request,env:Bindings):Promise<D1Sql> {
 const owner=await migrationOwner(request,env),actor=await authority(request,env,{post:request.method==='POST',stepUp:request.method==='POST'})
 if(actor.session.kind!=='native'||actor.member.role!=='owner'||Object.values(actor.member.scope).some(scope=>!scope.includes('*')))fail('unrestricted_native_owner_required')
 const now="CAST(unixepoch('subsec')*1000 AS INTEGER)"
 const native=`EXISTS(SELECT 1 FROM oa_sessions s JOIN porthole_members m ON m.operator_id=s.operator_id WHERE s.id=? AND s.kind='native' AND s.expires_at>${now} AND m.role='owner' AND m.scope=?)`
 const proof=`(EXISTS(SELECT 1 FROM oa_step_up_challenges WHERE session_id=? AND operator_id=? AND operator_version=? AND consumed_at>=${now}-300000) OR EXISTS(SELECT 1 FROM oa_sessions s JOIN oa_tokens t ON t.id=s.source_token_id WHERE s.id=? AND s.kind='native' AND s.created_at>=${now}-300000 AND t.consumed_at>=${now}-300000))`
 return {sql:`(${owner.sql}) AND (${native})${request.method==='POST'?` AND ${proof}`:''}`,params:[...owner.params??[],actor.session.id,JSON.stringify(actor.member.scope),...request.method==='POST'?[actor.session.id,actor.member.operatorId,actor.session.operator.version,actor.session.id]:[]]}
}
