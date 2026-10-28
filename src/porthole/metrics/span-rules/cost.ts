import {fail} from '../../security/authority'
import {object} from '../../ingest/model'
export interface CostModel {source:string;monthlySpans:number;bytesPerPoint:number;usdMicrosPerMillionSpans:number;usdMicrosPerSeriesMonth:number;usdMicrosPerGiBMonth:number;ceilingUsdMicros:number}
export function costModel(value:unknown):CostModel {
 const c=object(value),keys=['monthlySpans','bytesPerPoint','usdMicrosPerMillionSpans','usdMicrosPerSeriesMonth','usdMicrosPerGiBMonth','ceilingUsdMicros']
 if(Object.keys(c).sort().join(',')!==[...keys,'source'].sort().join(',')||typeof c.source!=='string'||!c.source.trim()||c.source.length>120||/[\x00-\x1f]/.test(c.source)||keys.some(k=>!Number.isSafeInteger(c[k])||Number(c[k])<0||Number(c[k])>1000000000000)||!c.bytesPerPoint)fail('invalid_metric_cost_model',400)
 return {...c,source:c.source.trim()} as unknown as CostModel
}
export function estimate(model:CostModel|undefined,maximumSeries:number) {
 if(!model)return {usdMicros:null,usd:null,model:null,maximumSeries,permissionToSpend:false}
 const ceil=(n:bigint,d:bigint)=>(n+d-1n)/d
 const compute=ceil(BigInt(model.monthlySpans)*BigInt(model.usdMicrosPerMillionSpans),1000000n),series=BigInt(maximumSeries)*BigInt(model.usdMicrosPerSeriesMonth),storage=ceil(BigInt(model.monthlySpans)*BigInt(model.bytesPerPoint)*BigInt(model.usdMicrosPerGiBMonth),1073741824n)
 const total=compute+series+storage
 if(total>BigInt(model.ceilingUsdMicros))fail('metric_cost_ceiling_exceeded',422)
 return {usdMicros:total.toString(),usd:`${total/1000000n}.${String(total%1000000n).padStart(6,'0')}`,components:{computeUsdMicros:compute.toString(),seriesUsdMicros:series.toString(),storageUsdMicros:storage.toString()},model,maximumSeries,permissionToSpend:false}
}
