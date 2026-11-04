import { fingerprint } from '../../../collectors/database/privacy.mjs'
/** Every OTLP database statement is masked before pending and stored wire are
 * constructed, independently of optional user pipelines. Never retain binds. */
export function databasePrivacy<T>(input:T):T {
 function walk(value:unknown):unknown {
  if(!value||typeof value!=='object')return value
  if(Array.isArray(value))return value.map(walk)
  const row=value as Record<string,unknown>,out:Record<string,unknown>={}
  for(const [key,child]of Object.entries(row)){
   if(key==='key'&&typeof child==='string'&&/^(?:db\.(?:statement|query\.text|operation\.text)|sql\.query)$/i.test(child))return {...row,value:{stringValue:fingerprint((row.value as Record<string,unknown>)?.stringValue)}}
   if(key==='key'&&typeof child==='string'&&/^(?:db\..*(?:parameters|bind|connection_string|user)|db\.session\.id)$/i.test(child))return {...row,value:{stringValue:'[withheld]'}}
   out[key]=/^(?:db\.(?:statement|query\.text)|sql\.query)$/i.test(key)?fingerprint(child):walk(child)
  }
  return out
 }
 return walk(input) as T
}
