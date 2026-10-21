import { append,read,genesis,digest,canonical,type AuditInput,type Checkpoint } from './store'
import { privateHeaders } from '../document'
/** Emit the ordinary independently readable packet in bounded pages. The
 * checkpoint is fixed before streaming, so concurrent actions cannot alter it. */
export function streamAudit(db:D1Database,head:Checkpoint,input:AuditInput):Response {
 const encoder=new TextEncoder()
 const stream=new ReadableStream<Uint8Array>({async start(controller) {
  try {
   controller.enqueue(encoder.encode(JSON.stringify({format:'porthole.audit.v1',checkpoint:head,range:{after:0,through:head.sequence},next:null}).slice(0,-1)+',"records":['))
   let sequence=0,hash=genesis,first=true
   while(sequence<head.sequence) {
    const rows=await read(db,sequence,head.sequence,100)
    if(!rows.length)throw Error('audit_integrity_failed')
    for(const row of rows) {
     if(row.entry.sequence!==sequence+1 || row.entry.previousHash!==hash || await digest(canonical(row.entry))!==row.hash)throw Error('audit_integrity_failed')
     controller.enqueue(encoder.encode((first?'':',')+JSON.stringify(row)));first=false;sequence=row.entry.sequence;hash=row.hash
    }
   }
   if(sequence!==head.sequence || hash!==head.hash)throw Error('audit_integrity_failed')
   await append(db,{...input,phase:'succeeded',status:200})
   controller.enqueue(encoder.encode(']}'));controller.close()
  }catch {
   try{await append(db,{...input,phase:'failed',status:503})}catch{}
   controller.error(new Error('audit_export_incomplete'))
  }
 }})
 return new Response(stream,{headers:{...privateHeaders,'content-type':'application/json','content-disposition':'attachment; filename="porthole-audit.json"'}})
}
