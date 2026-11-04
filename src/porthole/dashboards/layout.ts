import {fail,scopeWithin,type Scope} from '../security/authority'
import {label,scopeLabel,type Dashboard,type Panel} from './model'
export interface Cell {panel:string;width:number;height:number}
export interface Group {id:string;title:string;width:number;height:number;collapsed:boolean;variables?:{team?:string;environment?:string};service?:string;children:LayoutItem[];powerpack?:{id:string;revision:number}}
export type LayoutItem=Cell|Group
export const isGroup=(item:LayoutItem):item is Group=>'children' in item
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:fail('invalid_dashboard_layout',400)
const size=(v:unknown,max:number)=>Number.isInteger(v)&&Number(v)>=1&&Number(v)<=max?Number(v):fail('invalid_layout_size',400)
export function layoutBody(raw:unknown,panels:Panel[]):LayoutItem[] {
 const used=new Set<string>(),groups=new Set<string>();let count=0
 const visit=(raw:unknown,depth:number):LayoutItem[]=>{
  if(!Array.isArray(raw)||depth>4)fail('invalid_layout_nesting',400)
  return raw.map(value=>{
   if(++count>60)fail('too_many_layout_items',400)
   const p=object(value),width=size(p.width,12),height=size(p.height,4)
   if('panel' in p){const panel=scopeLabel(p.panel);if(Object.keys(p).some(k=>!['panel','width','height'].includes(k))||used.has(panel)||!panels.some(p=>p.id===panel))fail('invalid_layout_membership',400);used.add(panel);return {panel,width,height}}
   if(Object.keys(p).some(k=>!['id','title','width','height','collapsed','variables','service','children','powerpack'].includes(k)))fail('invalid_dashboard_layout',400)
   const id=scopeLabel(p.id)
   if(groups.has(id)||panels.some(p=>p.id===id)||typeof p.collapsed!=='boolean')fail('invalid_layout_group',400)
   groups.add(id)
   const variables=p.variables===undefined?undefined:object(p.variables)
   if(variables&&Object.keys(variables).some(k=>!['team','environment'].includes(k)))fail('invalid_group_variables',400)
   const binding=p.powerpack===undefined?undefined:object(p.powerpack)
   if(binding&&(Object.keys(binding).sort().join(',')!=='id,revision'||typeof binding.id!=='string'||!/^[a-f0-9-]{36}$/.test(binding.id)||!Number.isSafeInteger(binding.revision)||Number(binding.revision)<1))fail('invalid_powerpack_binding',400)
   const children=visit(p.children,depth+1)
   if(binding&&children.some(item=>isGroup(item)&&packBindings([item]).length))fail('nested_powerpacks_unsupported',400)
   return {id,title:label(p.title),width,height,collapsed:p.collapsed,...(p.service===undefined?{}:{service:scopeLabel(p.service)}),...(variables?{variables:{...(variables.team===undefined?{}:{team:scopeLabel(variables.team)}),...(variables.environment===undefined?{}:{environment:scopeLabel(variables.environment)})}}:{}),...(binding?{powerpack:{id:String(binding.id),revision:Number(binding.revision)}}:{}),children}
  })
 }
 const result=visit(raw,0)
 if(used.size!==panels.length)fail('layout_must_include_every_panel_once',400)
 return result
}
export function packBindings(layout:LayoutItem[]=[]):Group[] {
 return layout.flatMap(item=>isGroup(item)?[...(item.powerpack?[item]:[]),...packBindings(item.children)]:[])
}
export function boundPanels(body:Dashboard):{panel:Panel;team:string;environment:string}[] {
 if(!body.layout)return body.panels.map(panel=>({panel,...body.variables}))
 const visit=(items:LayoutItem[],vars:Dashboard['variables'],service?:string):ReturnType<typeof boundPanels>=>items.flatMap(item=>isGroup(item)?visit(item.children,{...vars,...item.variables},item.service??service):[{panel:{...body.panels.find(p=>p.id===item.panel)!,...(service?{service}:{})},...vars}])
 return visit(body.layout,body.variables)
}
export function validateDashboardScope(body:Dashboard,scope:Scope) {
 if(boundPanels(body).some(({panel,team,environment})=>!scopeWithin({services:[panel.service],teams:[team],environments:[environment]},scope)))fail('dashboard_child_scope_forbidden')
}
export function validateGroupScope(body:Dashboard,group:Group,scope:Scope,overrides:{team?:string;environment?:string}={}) {
 const ids=new Set(panelIds(group.children))
 if(boundPanels(body).some(({panel,team,environment})=>ids.has(panel.id)&&!scopeWithin({services:[panel.service],teams:[overrides.team??team],environments:[overrides.environment??environment]},scope)))fail('dashboard_child_scope_forbidden')
}
export function panelIds(items:LayoutItem[]):string[] {return items.flatMap(item=>isGroup(item)?panelIds(item.children):[item.panel])}
