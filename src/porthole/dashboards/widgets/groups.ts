import {escape} from '../../document'
import {fail} from '../../security/authority'
import {empty,grouped,svg,type WidgetInput} from './core'

export function groupMarkup(input:WidgetInput):string {
 if(!input.points.length)return empty()
 const groups=grouped(input),proportional=['pie','treemap'].includes(input.kind)
 if(proportional&&input.points.some(p=>p.value<0))fail('pie_and_treemap_require_nonnegative_values_choose_timeseries_or_table',400)
 const total=groups.reduce((sum,group)=>sum+group.mean,0)
 if(!Number.isFinite(total))fail('widget_numeric_overflow_reduce_value_range',400)
 const summary=`<div class="porthole-widget-table" role="region" aria-label="Series means" tabindex="0"><table data-total="${total}"><caption>Series ranked by arithmetic mean; ${escape(input.unit)}. Sum of series means: ${total}.</caption><thead><tr><th scope="col">Series</th><th scope="col">Arithmetic mean</th><th scope="col">Observations</th></tr></thead><tbody>${groups.map(g=>`<tr data-series="${escape(g.series)}" data-value="${g.mean}"><th scope="row">${escape(g.series)}</th><td>${g.mean}</td><td>${g.count}</td></tr>`).join('')}</tbody></table></div>`
 if(input.kind==='top_list')return summary
 if(input.kind==='list')return `<ol>${groups.map(g=>`<li>${escape(g.series)}: ${g.mean} ${escape(input.unit)} (${g.count} observations)</li>`).join('')}</ol>${summary}`
 if(!total)return `<p role="status">All series means are zero; there is no proportional area.</p>${summary}`
 let consumed=0
 const shapes=groups.filter(g=>g.mean>0).map((group,index,positive)=>{
  const share=group.mean/total,start=consumed;consumed+=share
  const label=escape(group.series+' — arithmetic mean '+group.mean+' '+input.unit),opacity=.25+.6*(index+1)/positive.length
  if(input.kind==='treemap')return `<rect x="${20+start*240}" y="20" width="${share*240}" height="160" fill="currentColor" fill-opacity="${opacity}" stroke="currentColor" stroke-width="0.5" aria-label="${label}"><title>${label}</title></rect>`
  if(positive.length===1)return `<circle cx="140" cy="100" r="80" fill="currentColor" fill-opacity="${opacity}" aria-label="${label}"><title>${label}</title></circle>`
  const angle=(fraction:number)=>fraction*2*Math.PI-Math.PI/2,sx=140+Math.cos(angle(start))*80,sy=100+Math.sin(angle(start))*80,ex=140+Math.cos(angle(consumed))*80,ey=100+Math.sin(angle(consumed))*80
  return `<path d="M140 100L${sx} ${sy}A80 80 0 ${share>.5?1:0} 1 ${ex} ${ey}Z" fill="currentColor" fill-opacity="${opacity}" stroke="currentColor" stroke-width="0.5" aria-label="${label}"><title>${label}</title></path>`
 }).join('')
 return `<div>${svg(input.title+' — proportional arithmetic means',shapes,200)}<p>Area is proportional to each series arithmetic mean. Zero means have no area. The exact totals and all series appear below.</p></div>${summary}`
}
