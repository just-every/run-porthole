import type {Bindings} from '../../../auth.server'
import {fail,scopeWithin,type Authority} from '../../security/authority'
import {dashboardBody,type Dashboard,type DashboardRow} from '../model'
import {isGroup,packBindings,panelIds,validateDashboardScope,type Group,type LayoutItem} from '../layout'
import {powerpackBody,type PowerpackRow} from './model'
export function installPack(body:Dashboard,groupId:string,pack:PowerpackRow):Dashboard {
 const template=powerpackBody(JSON.parse(pack.body)),group=packBindings(body.layout).find(group=>group.id===groupId)??fail('powerpack_binding_not_found',400)
 const old=new Set(panelIds(group.children)),prefix=group.id+':'
 const copy=(items:LayoutItem[]):LayoutItem[]=>items.map(item=>isGroup(item)?{...item,id:prefix+item.id,children:copy(item.children)}:{...item,panel:prefix+item.panel})
 const replace=(items:LayoutItem[]):LayoutItem[]=>items.map(item=>isGroup(item)?item.id===group.id?{...item,powerpack:{id:pack.id,revision:pack.revision},children:copy(template.layout!)}:{...item,children:replace(item.children)}:item)
 return dashboardBody({...body,panels:[...body.panels.filter(p=>!old.has(p.id)),...template.panels.map(p=>({...p,id:prefix+p.id}))],layout:replace(body.layout!)})
}
export async function resolvePacks(env:Bindings,actor:Authority,body:Dashboard,scope:Parameters<typeof validateDashboardScope>[1]):Promise<Dashboard> {
 for(const group of packBindings(body.layout)) {
  const pack=await env.DB.prepare(`SELECT * FROM porthole_powerpacks WHERE id=? AND ${actor.fence}`).bind(group.powerpack!.id,...actor.args).first<PowerpackRow>()
  if(!pack||!scopeWithin(JSON.parse(pack.scope),actor.member.scope))fail('powerpack_not_found',404)
  if(pack.state!=='active'||pack.revision!==group.powerpack!.revision)fail('powerpack_revision_changed',409)
  body=installPack(body,group.id,pack)
  const children=panelIds(packBindings(body.layout).find(g=>g.id===group.id)!.children)
  // A binding may narrow visibility, never expand the pack's reviewed scope.
  const selected=dashboardBody({...body,panels:body.panels.filter(p=>children.includes(p.id)),layout:[packBindings(body.layout).find(g=>g.id===group.id)!]})
  validateDashboardScope(selected,JSON.parse(pack.scope))
 }
 validateDashboardScope(body,scope)
 return body
}
export function packFence(body:Dashboard):{sql:string;args:unknown[]} {
 const groups=packBindings(body.layout)
 return {sql:groups.map(()=>"EXISTS(SELECT 1 FROM porthole_powerpacks WHERE id=? AND revision=? AND state='active')").join(' AND ')||'1',args:groups.flatMap(group=>[group.powerpack!.id,group.powerpack!.revision])}
}
export const usesPack=(row:DashboardRow,id:string)=>packBindings(dashboardBody(JSON.parse(row.body)).layout).some(group=>group.powerpack!.id===id)
