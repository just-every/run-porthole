import {object,type Signal} from '../ingest/model'
import {decode} from '../ingest/otlp-proto'
import {readBytes,utf8} from '../ingest/wire'
import {assertGenAIMetadata} from './privacy'

/** Archives retain original OTLP wire independently of normalized records.
 * Inspect that copy before staging; compression never supplies content consent.
 * The archive format predates encoding metadata, so recognize gzip and JSON
 * from their wire signatures and otherwise use the declared signal's protobuf.
 */
export async function assertGenAIWire(encoded:string,protocol:string,signal:Signal):Promise<void> {
 if(!protocol.startsWith('otlp.http/'))return
 let body:Uint8Array=Uint8Array.from(atob(encoded),char=>char.charCodeAt(0))
 if(!body.length)return // Erased envelopes intentionally retain no source wire.
 if(body[0]===31&&body[1]===139)body=await readBytes(new Response(new Uint8Array(body).buffer).body!.pipeThrough(new DecompressionStream('gzip')))
 const first=body.find(byte=>![9,10,13,32].includes(byte))
 const data=first===123?object(JSON.parse(utf8(body))):decode(body,signal==='traces'?'Traces':signal==='logs'?'Logs':signal==='profiles'?'Profiles':'Metrics')
 assertGenAIMetadata(data)
}
