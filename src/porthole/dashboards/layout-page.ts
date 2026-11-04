import {escape} from '../document'
import {isGroup,type LayoutItem} from './layout'
import type {DashboardRow} from './model'
import type {PanelResult} from './read'
export function layoutMarkup(items:LayoutItem[],row:DashboardRow,render:(result:PanelResult)=>string,results:PanelResult[],canEdit:boolean):string {
 const hidden=`<input type="hidden" name="id" value="${row.id}"><input type="hidden" name="revision" value="${row.revision}">`
 const visit=(items:LayoutItem[],editable:boolean):string=>`<div class="porthole-layout">${items.map((item,index)=>{
  const id=isGroup(item)?item.id:item.panel
  const binding=isGroup(item)?`<form method="post" action="/app/dashboards/layout" aria-label="Group scope bindings">${hidden}<input type="hidden" name="group" value="${escape(id)}"><input type="hidden" name="binding" value="scope"><p>Blank bindings inherit from the containing group or dashboard. Dashboard URL variables override team and environment.</p>${(['service','team','environment'] as const).map(key=>`<label>${key[0].toUpperCase()+key.slice(1)} binding <input name="${key}" value="${escape(key==='service'?item.service??'':item.variables?.[key]??'')}" placeholder="Inherit ${key}" maxlength="120"></label>`).join('')}<button>Save bindings</button></form>`:''
  const controls=editable?`<details class="porthole-layout-controls"><summary>Layout settings</summary><form method="post" action="/app/dashboards/layout">${hidden}<input type="hidden" name="group" value="${escape(id)}"><label>Width <select aria-label="Width" name="width">${[3,4,6,8,9,12].map(width=>`<option ${width===item.width?'selected':''}>${width}</option>`).join('')}${![3,4,6,8,9,12].includes(item.width)?`<option selected>${item.width}</option>`:''}</select></label><label>Height <select aria-label="Height" name="height">${[1,2,3,4].map(height=>`<option ${height===item.height?'selected':''}>${height}</option>`).join('')}</select></label><button>Save size</button><button name="direction" value="up" ${index===0?'disabled':''}>Move up</button><button name="direction" value="down" ${index===items.length-1?'disabled':''}>Move down</button>${isGroup(item)?`<button name="collapsed" value="${!item.collapsed}">${item.collapsed?'Expand':'Collapse'} group</button>`:''}</form>${binding}</details>`:''
  if(isGroup(item))return `<section data-layout-group="${escape(item.id)}" class="porthole-layout-group porthole-span-${item.width} porthole-height-${item.height}"><details class="porthole-group-content" ${item.collapsed?'':'open'}><summary>${escape(item.title)}</summary>${item.powerpack?`<p>Powerpack revision ${item.powerpack.revision}</p>`:''}${visit(item.children,editable&&!item.powerpack)}</details>${controls}</section>`
  const result=results.find(result=>result.panel.id===item.panel)
  return `<div data-layout-panel="${escape(item.panel)}" class="porthole-span-${item.width} porthole-height-${item.height}">${result?render(result):'<p role="status">Unavailable while inactive.</p>'}${controls}</div>`
 }).join('')}</div>`
 return visit(items,canEdit)
}
