import { fail } from '../../security/authority'
import { object } from '../../ingest/model'

export type Predicate = {all:Predicate[]}|{any:Predicate[]}|{not:Predicate}|{field:string;op:'eq'|'ne'|'gt'|'gte'|'lt'|'lte'|'exists';value?:string|number|boolean}
export function field(value:unknown):string {
 if(typeof value!=='string'||!/^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/.test(value)||/auth|token|secret|password|cookie|credential|session|email|phone|address|user.?id|customer.?id|ssn|social.?security|card|credit|cvv|birth|iban|account|first.?name|last.?name/i.test(value))fail('field_refused',422)
 return value
}
export function predicate(value:unknown,depth=0,budget={left:32}):Predicate {
 if(depth>5||--budget.left<0)fail('predicate_too_complex',422)
 const p=object(value),keys=Object.keys(p)
 for(const key of ['all','any'] as const)if(key in p){
  if(keys.length!==1||!Array.isArray(p[key])||!p[key].length||p[key].length>16)fail('invalid_predicate',400)
  return {[key]:p[key].map(v=>predicate(v,depth+1,budget))} as Predicate
 }
 if('not' in p){if(keys.length!==1)fail('invalid_predicate',400);return {not:predicate(p.not,depth+1,budget)}}
 const key=field(p.field),op=p.op
 if(keys.some(k=>!['field','op','value'].includes(k))||!['eq','ne','gt','gte','lt','lte','exists'].includes(String(op)))fail('invalid_predicate',400)
 if(op==='exists'){if('value' in p)fail('invalid_predicate',400);return {field:key,op}}
 if(!['string','number','boolean'].includes(typeof p.value)||typeof p.value==='number'&&!Number.isFinite(p.value)||typeof p.value==='string'&&(p.value.length>160||/[\x00-\x1f]/.test(p.value))||!['eq','ne'].includes(String(op))&&typeof p.value!=='number')fail('invalid_predicate',400)
 return {field:key,op:op as 'eq',value:p.value as string|number|boolean}
}
// SQL expressions are selected here; every caller-supplied field and value is bound.
export function expression(key:string,args:unknown[],numeric=false):string {
 if(key==='duration')return "(CAST(json_extract(j.value,'$.payload.record.endTimeUnixNano') AS INTEGER)-CAST(json_extract(j.value,'$.payload.record.startTimeUnixNano') AS INTEGER))"
 if(key==='span.name')return "json_extract(j.value,'$.payload.record.name')"
 if(key==='span.kind')return "json_extract(j.value,'$.payload.record.kind')"
 if(key==='span.status')return "json_extract(j.value,'$.payload.record.status.code')"
 const resource=key.startsWith('resource.'),path=resource?'$.payload.resource.attributes':'$.payload.record.attributes'
 args.push(resource?key.slice(9):key)
 const raw=numeric?"COALESCE(json_extract(a.value,'$.value.doubleValue'),CASE WHEN json_type(a.value,'$.value.intValue') IN ('text','integer') AND CAST(CAST(json_extract(a.value,'$.value.intValue') AS INTEGER) AS TEXT)=CAST(json_extract(a.value,'$.value.intValue') AS TEXT) THEN CAST(json_extract(a.value,'$.value.intValue') AS REAL) END)":"COALESCE(json_extract(a.value,'$.value.stringValue'),json_extract(a.value,'$.value.intValue'),json_extract(a.value,'$.value.doubleValue'),json_extract(a.value,'$.value.boolValue'))"
 return `(SELECT ${raw} FROM json_each(j.value,'${path}') a WHERE json_extract(a.value,'$.key')=?)`
}
export function predicateSql(p:Predicate,args:unknown[]):string {
 if('all' in p)return '('+p.all.map(v=>predicateSql(v,args)).join(' AND ')+')'
 if('any' in p)return '('+p.any.map(v=>predicateSql(v,args)).join(' OR ')+')'
 if('not' in p)return '(NOT '+predicateSql(p.not,args)+')'
 const value=expression(p.field,args,typeof p.value==='number')
 if(p.op==='exists')return `(${value} IS NOT NULL)`
 args.push(p.value)
 const operator={eq:'=',ne:'!=',gt:'>',gte:'>=',lt:'<',lte:'<='}[p.op]
 return `COALESCE((${value} ${operator} ?),0)`
}
