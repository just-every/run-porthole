import {escape} from '../../document'
import {clock,empty,range,short,svg,table,utc,type WidgetInput} from './core'

export function timeseries(input:WidgetInput):string {
 if(!input.points.length)return empty()
 const {min,max,span}=range(input),from=BigInt(input.from),through=BigInt(input.through),duration=through-from
 const x=(time:string)=>40+(duration?Number(BigInt(time)-from)/Number(duration):.5)*220
 const y=(value:number)=>176-(span?(value-min)/span:.5)*144
 const groups=new Map<string,typeof input.points>()
 for(const point of input.points){const points=groups.get(point.series)??[];points.push(point);groups.set(point.series,points)}
 const paths=[...groups].map(([series,points],index)=>{
  const sorted=[...points].sort((a,b)=>BigInt(a.timeNs)<BigInt(b.timeNs)?-1:BigInt(a.timeNs)>BigInt(b.timeNs)?1:0)
  return `<g aria-label="${escape(series)}"><polyline points="${sorted.map(p=>`${x(p.timeNs)},${y(p.value)}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="${['none','5 3','2 3','8 3 2 3'][index%4]}">${`<title>${escape(series)}</title>`}</polyline>${sorted.map(p=>`<circle cx="${x(p.timeNs)}" cy="${y(p.value)}" r="2.5"><title>${escape(series)} · ${escape(p.timeNs)} ns · ${escape(p.value)} ${escape(input.unit)}</title></circle>`).join('')}</g>`
 }).join('')
 return `<div>${svg(input.title+' — values by timestamp',`<path d="M40 28V176H260" fill="none" stroke="currentColor"/><text x="0" y="25">${escape(short(max))}</text><text x="0" y="176">${escape(short(min))}</text>${paths}<text x="40" y="202">${escape(clock(input.from))}</text><text x="260" y="218" text-anchor="end">${escape(clock(input.through))}</text>`)}<p>UTC range: ${escape(utc(input.from))} through ${escape(utc(input.through))}. Unit: ${escape(input.unit)}. Lines join observed points only; no missing values are filled. Series: ${[...groups.keys()].map(escape).join(', ')}.</p></div>`
}
export function distribution(input:WidgetInput):string {
 if(!input.points.length)return empty()
 const {min,max,span}=range(input),bins=span?Math.min(6,Math.ceil(Math.sqrt(input.points.length))):1,counts=Array<number>(bins).fill(0)
 for(const point of input.points)counts[span?Math.min(bins-1,Math.floor((point.value-min)/span*bins)):0]++
 const largest=Math.max(...counts),width=220/bins
 const bars=counts.map((count,index)=>`<rect data-count="${count}" x="${40+index*width+1}" y="${176-count/largest*140}" width="${Math.max(1,width-2)}" height="${count/largest*140}" fill="currentColor" fill-opacity="0.65"><title>${count} observations</title></rect><text x="${40+(index+.5)*width}" y="${168-count/largest*140}" text-anchor="middle">${count}</text>`).join('')
 const rows=counts.map((count,index)=>[min+span*index/bins,min+span*(index+1)/bins,index===bins-1?'inclusive':'exclusive',count])
 return `<div>${svg(input.title+' — value distribution',`${bars}<path d="M40 28V176H260" fill="none" stroke="currentColor"/><text x="40" y="202">${escape(short(min))}</text><text x="260" y="218" text-anchor="end">${escape(short(max))}</text>`)}<p>Equal-width value buckets; ${input.points.length} observations. Unit: ${escape(input.unit)}.</p></div>${table(['Lower inclusive','Upper','Upper boundary','Count'],rows,'Distribution bucket counts')}`
}
export function heatmap(input:WidgetInput):string {
 if(!input.points.length)return empty()
 const {min,span}=range(input),start=BigInt(input.from),extent=BigInt(input.through)-start+1n,budget=Math.ceil(Math.sqrt(input.points.length)),cols=Math.min(8,budget,Number(extent)),rows=span?Math.min(6,budget):1,counts=Array<number>(cols*rows).fill(0)
 for(const point of input.points) {
  const col=Number((BigInt(point.timeNs)-start)*BigInt(cols)/extent),row=span?Math.min(rows-1,Math.floor((point.value-min)/span*rows)):0
  counts[row*cols+col]++
 }
 const max=Math.max(...counts),width=220/cols,height=144/rows,data:(string|number)[][]=[]
 const cells=counts.map((count,index)=>{
  const row=Math.floor(index/cols),col=index%cols,timeFrom=start+(extent*BigInt(col)+BigInt(cols)-1n)/BigInt(cols),timeThrough=start+(extent*BigInt(col+1)+BigInt(cols)-1n)/BigInt(cols)-1n
  if(count)data.push([String(timeFrom),String(timeThrough),min+span*row/rows,min+span*(row+1)/rows,row===rows-1?'inclusive':'exclusive',count])
  return `<rect data-count="${count}" x="${40+col*width}" y="${32+(rows-row-1)*height}" width="${width}" height="${height}" fill="currentColor" fill-opacity="${count/max*.65}" stroke="currentColor" stroke-opacity="0.15"><title>${count} observations</title></rect>${count?`<text x="${40+(col+.5)*width}" y="${32+(rows-row-.5)*height+4}" text-anchor="middle">${count}</text>`:''}`
 }).join('')
 return `<div>${svg(input.title+' — time and value bucket counts',`${cells}<text x="0" y="25">${escape(short(min+span))}</text><text x="0" y="176">${escape(short(min))}</text><text x="40" y="202">${escape(clock(input.from))}</text><text x="260" y="218" text-anchor="end">${escape(clock(input.through))}</text>`)}<p>UTC range: ${escape(utc(input.from))} through ${escape(utc(input.through))}. Time runs horizontally; value in ${escape(input.unit)} vertically. Cell numbers are exact observation counts; blank cells contain zero.</p></div>${table(['From ns inclusive','Through ns inclusive','Value lower inclusive','Value upper','Upper boundary','Count'],data,'Nonempty heatmap buckets')}`
}
