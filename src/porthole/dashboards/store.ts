import type {Bindings} from '../../auth.server'
import {fail,scopeWithin,type Authority} from '../security/authority'
import type {DashboardRow} from './model'
export async function currentDashboard(env:Bindings,actor:Authority,id:string) {
 const row=await env.DB.prepare(`SELECT * FROM porthole_dashboards WHERE id=? AND ${actor.fence}`).bind(id,...actor.args).first<DashboardRow>()
 if(!row)fail('dashboard_not_found',404)
 if(!scopeWithin(JSON.parse(row.scope),actor.member.scope))fail('scope_forbidden')
 return row
}
