import {baseOperatorAuth,type Bindings} from '../../auth.server'
import {createBusinessSettings} from '../../modules/business-settings/index.ts'
import type {TeamAdapter} from '../../modules/business-settings/types.ts'

/** Signed team writes keep the native product sidecar and Base role in the
 * same guarded transaction. Local product grants are retained, never widened. */
export function businessSettings(env:Bindings) {
 const native=baseOperatorAuth(env).businessTeam
 if(!native)throw Error('Native Business team adapter unavailable')
 const team:TeamAdapter={ownerEmail:()=>native.ownerEmail!(),async prepare(input){
  const plan=await native.prepare(input)
  const statements=[...plan.statements]
  for(const row of plan.rows)if(row.operatorId)statements.push(env.DB.prepare(`UPDATE porthole_members SET role=CASE WHEN (SELECT role FROM oa_operators WHERE id=operator_id)='admin' THEN 'admin' ELSE 'read-only analyst' END WHERE operator_id=? AND role!='owner' AND CASE WHEN role IN ('owner','admin') THEN role ELSE 'member' END!=(SELECT role FROM oa_operators WHERE id=operator_id) AND ${input.guard.sql}`).bind(row.operatorId,...input.guard.args))
  return {...plan,statements}
 }}
 return createBusinessSettings({db:env.DB,trust:env.RER_BUSINESS_TRUST,business:{settings:1,values:['display_name'],team:{roles:{admin:'admin',member:'member'}}},team})
}
