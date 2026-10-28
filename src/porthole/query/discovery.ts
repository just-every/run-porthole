interface Attribute {key:string;value:Record<string,unknown>}
/** Types only, derived from this authorized page. Never retain sample values. */
export function discoverAttributes(records:{payload:{record?:{attributes?:Attribute[]};resource?:{attributes?:Attribute[]};metric?:{name?:string;unit?:string}}}[]) {
 const types=new Map<string,Set<string>>(),metrics=new Map<string,Set<string>>()
 const add=(path:string,type:string)=>{if(!types.has(path))types.set(path,new Set());types.get(path)!.add(type)}
 const visit=(attributes:Attribute[]|undefined,prefix='',depth=0)=>{
  if(!Array.isArray(attributes)||depth>16)return
  for(const {key,value}of attributes){if(typeof key!=='string'||!value||typeof value!=='object')continue;const path=prefix+key
   for(const [wire,type]of [['stringValue','string'],['intValue','number'],['doubleValue','number'],['boolValue','boolean'],['arrayValue','array'],['bytesValue','bytes'],['kvlistValue','object']])if(Object.hasOwn(value,wire))add(path,type)
   const nested=value.kvlistValue as {values?:Attribute[]}|undefined;if(nested)visit(nested.values,path+'.',depth+1)
  }
 }
 for(const row of records){visit(row.payload.record?.attributes);visit(row.payload.resource?.attributes);const metric=row.payload.metric;if(metric?.name){if(!metrics.has(metric.name))metrics.set(metric.name,new Set());metrics.get(metric.name)!.add(metric.unit??'')}}
 return {attributes:[...types].sort(([a],[b])=>a.localeCompare(b)).map(([path,values])=>({path,types:[...values].sort()})),metrics:[...metrics].sort(([a],[b])=>a.localeCompare(b)).map(([name,units])=>({name,units:[...units].sort()}))}
}
