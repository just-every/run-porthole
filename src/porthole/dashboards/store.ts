import type {Bindings} from '../../auth.server'
import {fail,scopeWithin,type Authority} from '../security/authority'
import {dashboardPolicy} from '../authorization/dashboard-policy'
import type {DashboardRow} from './model'
export async function currentDashboard(env:Bindings,actor:Authority,id:string,edit=false) {
 const policy=dashboardPolicy('d',actor.member.operatorId,edit)
 const row=await env.DB.prepare(`SELECT d.* FROM porthole_dashboards d WHERE d.id=? AND ${actor.fence} AND ${policy.sql}`).bind(id,...actor.args,...policy.args).first<DashboardRow>()
 if(!row)fail('dashboard_not_found',404)
 if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
 return row
}
