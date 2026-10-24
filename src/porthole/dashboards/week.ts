import {escape} from '../document'
import type {PanelResult} from './read'
import {widgetMarkup} from './widgets'
export function weekComparison(current:PanelResult,previous:PanelResult,from:string,through:string):string {
 const week=604800000000000n
 const overlay=widgetMarkup({kind:'timeseries',title:current.panel.title+' — previous UTC week overlay',unit:current.unit??current.panel.unit,value:current.value,from,through,records:[],points:[...(current.points??[]).map(point=>({...point,series:'Current: '+point.series})),...(previous.points??[]).map(point=>({...point,timeNs:String(BigInt(point.timeNs)+week),series:'Previous UTC week: '+point.series}))]})
 return `<section aria-label="Previous UTC week"><h3>Previous UTC week</h3><p role="status">${escape(previous.state)}${previous.error?': '+escape(previous.error.replaceAll('_',' ')):''}</p><p>Previous value: ${previous.value===null?'No complete value':escape(previous.value)} ${escape(previous.unit??current.panel.unit)}.</p><p>Fixed offset: seven times 24 hours in UTC. This comparison does not align local calendar hours across daylight-saving transitions. Prior timestamps shift forward by this exact offset only for the overlay. Missing observations remain missing; no interpolation or zero fill.</p>${overlay}${previous.query?`<a href="${escape(previous.query)}">Open previous week source query</a>`:''}</section>`
}
