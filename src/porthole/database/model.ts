import { fingerprint } from '../../../collectors/database/privacy.mjs'
import { fail } from '../security/authority'
export interface Capture {
 engine:'postgresql'|'mysql'; version:string; collectedAt:number; databaseTime:number
 coverage:Record<string,string>; queries:{queryId:string;fingerprint:string;calls:number;totalMs:number;meanMs:number;rows:number;plan:{operator:string;estimatedRows?:number;estimatedCost?:number;estimatedWidth?:number;estimatedOutputRows?:number}[]}[]
 waits:{waiting:string;blocking:string;kind:string;queryId:string|null;traceId:string|null;spanId:string|null}[]
}
export function captureInput(raw:unknown):Capture {
 const bad=()=>fail('invalid_database_capture',400),obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:bad()
 const d=obj(raw)
 if(Object.keys(d).some(k=>!['engine','version','collectedAt','databaseTime','coverage','queries','waits'].includes(k))||!['postgresql','mysql'].includes(String(d.engine))||typeof d.version!=='string'||!/^\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?$|^unavailable$/.test(d.version))bad()
 for(const key of ['collectedAt','databaseTime'])if(!Number.isSafeInteger(d[key])||Number(d[key])<0||Number(d[key])>Date.now()+60000)bad()
 const coverage=obj(d.coverage)
 if(Object.keys(coverage).sort().join(',')!=='plans,statistics,waits'||Object.values(coverage).some(v=>!['collected','privilege_denied','unavailable','not_reviewed'].includes(String(v))))bad()
 if(!Array.isArray(d.queries)||d.queries.length>25||!Array.isArray(d.waits)||d.waits.length>100)bad()
 const queries=(d.queries as unknown[]).map(raw=>{
  const q=obj(raw)
  if(Object.keys(q).sort().join(',')!=='calls,fingerprint,meanMs,plan,queryId,rows,totalMs'||typeof q.queryId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(q.queryId))bad()
  if(typeof q.fingerprint!=='string')bad()
  for(const key of ['calls','totalMs','meanMs','rows'])if(typeof q[key]!=='number'||!Number.isFinite(q[key])||Number(q[key])<0||Number(q[key])>1e15)bad()
  if(!Array.isArray(q.plan)||q.plan.length>64)bad()
  const plan=(q.plan as unknown[]).map(raw=>{
   const p=obj(raw)
   if(Object.keys(p).some(k=>!['operator','estimatedRows','estimatedCost','estimatedWidth','estimatedOutputRows'].includes(k))||typeof p.operator!=='string'||!/^[a-zA-Z_ ]{1,64}$/.test(p.operator))bad()
   for(const [key,value]of Object.entries(p))if(key!=='operator'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1e15))bad()
   return p as Capture['queries'][number]['plan'][number]
  })
  return {...q,fingerprint:fingerprint(q.fingerprint),plan} as Capture['queries'][number]
 })
 const waits=(d.waits as unknown[]).map(raw=>{
  const w=obj(raw)
  if(Object.keys(w).sort().join(',')!=='blocking,kind,queryId,spanId,traceId,waiting'||typeof w.waiting!=='string'||!/^\d{1,20}$/.test(w.waiting)||typeof w.blocking!=='string'||!/^\d{1,20}$/.test(w.blocking)||!['Lock','RECORD','TABLE','unknown'].includes(String(w.kind)))bad()
  if(w.queryId!==null&&(typeof w.queryId!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(w.queryId)))bad()
  if(w.traceId!==null&&(typeof w.traceId!=='string'||!/^[a-f0-9]{32}$/.test(w.traceId))||w.spanId!==null&&(typeof w.spanId!=='string'||!/^[a-f0-9]{16}$/.test(w.spanId)))bad()
  return w as Capture['waits'][number]
 })
 return {engine:d.engine as Capture['engine'],version:String(d.version),collectedAt:Number(d.collectedAt),databaseTime:Number(d.databaseTime),coverage:coverage as Record<string,string>,queries,waits}
}
