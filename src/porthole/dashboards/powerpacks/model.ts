import {dashboardBody,type Dashboard,type DashboardRow} from '../model'
import {packBindings} from '../layout'
import {fail} from '../../security/authority'
export type PowerpackRow=DashboardRow
export function powerpackBody(raw:unknown):Dashboard {
 const body=dashboardBody(raw)
 if(!body.layout||!body.panels.length||packBindings(body.layout).length)fail('powerpack_requires_native_layout_without_pack_references',400)
 return body
}
