import {attributes} from '../ingest/normalize'
import type {NativeSample} from './splunk/signalflow/evaluate'

/** Only common observed metadata survives a cross-series aggregate. Source
 * definition tags never stand in for observed metric tags. */
export function comparisonContext(records:NativeSample[],series?:{metadata:Record<string,unknown>}[]){
 const dimensions=series?.length?series.map(item=>item.metadata.dimensions as Record<string,unknown>):records.map(row=>{
  const resource=attributes(row.payload.resource.attributes)
  return Object.fromEntries(['service','environment','team'].flatMap(key=>{
   const candidates=key==='service'?['service.name','service_name','service','job']:key==='environment'?['deployment.environment.name','deployment.environment','deployment_environment_name','deployment_environment','environment','env']:['team.name','team_name','team']
   const value=candidates.map(name=>resource[name]).find(value=>value!==undefined)
   return typeof value==='string'?[[key,value]]:[]
  }))
 })
 const common=dimensions.length?Object.fromEntries(Object.entries(dimensions[0]).filter(([key,value])=>typeof value==='string'&&dimensions.every(item=>item[key]===value))):undefined
 const tags=series?.length&&series.every(item=>Array.isArray(item.metadata.tags)&&item.metadata.tags.every(tag=>typeof tag==='string'))?series.map(item=>[...item.metadata.tags as string[]].sort()):undefined
 return {...(common?{dimensions:common as Record<string,string>}:{ }),...(tags?.length&&tags.every(value=>JSON.stringify(value)===JSON.stringify(tags[0]))?{tags:tags[0]}:{})}
}
