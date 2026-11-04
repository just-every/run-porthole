import { fingerprint } from './sql.mjs'
/** Every OTLP database statement is masked before pending and stored wire are
 * constructed, independently of optional user pipelines. Never retain binds. */
export function databasePrivacy<T>(input:T):T {
 function walk(value:unknown,database=false,capture=false):unknown {
  if(!value||typeof value!=='object')return value
  if(Array.isArray(value))return value.map(v=>walk(v,database,capture))
  const row=value as Record<string,unknown>,out:Record<string,unknown>={}
  const marked=database||Array.isArray(row.attributes)&&row.attributes.some(a=>a&&typeof a==='object'&&typeof a.key==='string'&&a.key.startsWith('db.'))
  if(typeof row.key==='string'){
   if(/^(?:db\.(?:statement|query\.text|operation\.text)|sql\.query)$/i.test(row.key))return {...row,value:{stringValue:fingerprint((row.value as Record<string,unknown>)?.stringValue)}}
   if(/^(?:db\..*(?:parameters|bind|connection_string|user)|db\.session\.id)$/i.test(row.key)||marked&&/^(?:exception\.(?:message|stacktrace)|error\.message)$/.test(row.key))return {...row,value:{stringValue:'[withheld]'}}
  }
  for(const [key,child]of Object.entries(row)){
   if(marked&&key==='message'&&typeof child==='string')out[key]='[withheld]'
   else if(capture&&key==='fingerprint')out[key]=fingerprint(child)
   else out[key]=/^(?:db\.(?:statement|query\.text)|sql\.query)$/i.test(key)?fingerprint(child):walk(child,marked,capture||key==='databaseCapture')
  }
  return out
 }
 return walk(input) as T
}

/** Older original-wire archives cannot reintroduce statements that current
 * ingestion would redact. Stored sanitized envelopes are checked as records. */
export async function assertDatabaseWire(encoded:string,protocol:string,signal:string):Promise<void> {
 if(!encoded||!protocol.startsWith('otlp.http/')||protocol.includes(';stored='))return
 const {decode}=await import('../ingest/otlp-proto'),{readBytes,utf8}=await import('../ingest/wire')
 let bytes:Uint8Array=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))
 if(bytes[0]===31&&bytes[1]===139)bytes=await readBytes(new Response(new Uint8Array(bytes).buffer).body!.pipeThrough(new DecompressionStream('gzip')))
 const first=bytes.find(b=>![9,10,13,32].includes(b)),value=first===123?JSON.parse(utf8(bytes)):decode(bytes,signal==='traces'?'Traces':signal==='logs'?'Logs':signal==='metrics'?'Metrics':'Profiles')
 if(JSON.stringify(value)!==JSON.stringify(databasePrivacy(value)))throw Error('database_content_not_redacted')
}
