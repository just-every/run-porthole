import { append,read,genesis,digest,canonical,type AuditInput,type Checkpoint } from './store'
import { privateHeaders } from '../document'
/** One pinned chain, one bounded page per consumer pull. */
export function streamAudit(db:D1Database,head:Checkpoint,input:AuditInput):Response {
 const encoder=new TextEncoder()
 let sequence=0,hash=genesis,first=true,header=false,ended=false
 const stream=new ReadableStream<Uint8Array>({
  async pull(controller) {
   if(ended)return
   try {
    if(!header) {
     header=true
     controller.enqueue(encoder.encode(JSON.stringify({format:'porthole.audit.v1',checkpoint:head,range:{after:0,through:head.sequence},next:null}).slice(0,-1)+',"records":['))
     return
    }
    if(sequence<head.sequence) {
     const rows=await read(db,sequence,head.sequence,100)
     if(ended)return
     if(!rows.length)throw Error('audit_integrity_failed')
     const encoded:string[]=[]
     for(const row of rows) {
      if(row.entry.sequence!==sequence+1 || row.entry.previousHash!==hash || await digest(canonical(row.entry))!==row.hash)throw Error('audit_integrity_failed')
      encoded.push((first?'':',')+JSON.stringify(row));first=false;sequence=row.entry.sequence;hash=row.hash
     }
     if(!ended)controller.enqueue(encoder.encode(encoded.join('')))
     return
    }
    if(sequence!==head.sequence || hash!==head.hash)throw Error('audit_integrity_failed')
    await append(db,{...input,phase:'succeeded',status:200})
    if(ended)return
    ended=true;controller.enqueue(encoder.encode(']}'));controller.close()
   } catch {
    if(ended)return
    ended=true
    try{await append(db,{...input,phase:'failed',status:503})}catch{}
    controller.error(new Error('audit_export_incomplete'))
   }
  },
  async cancel() {
   if(ended)return
   ended=true
   await append(db,{...input,phase:'failed',status:null})
  },
 })
 return new Response(stream,{headers:{...privateHeaders,'content-type':'application/json','content-disposition':'attachment; filename="porthole-audit.json"'}})
}
