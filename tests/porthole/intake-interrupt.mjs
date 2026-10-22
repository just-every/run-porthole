import assert from 'node:assert/strict'
import {connect} from 'node:net'
import {request} from 'node:http'
import {literal} from './fixture.mjs'

/** Real socket interruption, with no service failure switch or fake intake. */
export async function intakeInterruptJourney({origin,secret,packet,restartWorker,sql,send}) {
 const target=new URL(origin),body=Buffer.from(JSON.stringify(packet))
 await new Promise((resolve,reject)=>{
  const socket=connect(Number(target.port),target.hostname)
  socket.on('error',()=>reject(Error('synthetic-porthole-242 partial intake transport failed')))
  socket.once('connect',()=>{
   const headers=`POST /v1/logs HTTP/1.1\r\nHost: ${target.host}\r\nAuthorization: Bearer ${secret}\r\nContent-Type: application/json\r\nX-Porthole-Batch-ID: synthetic-porthole-242\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`
   socket.write(Buffer.concat([Buffer.from(headers),body.subarray(0,Math.floor(body.length/2))]),()=>{socket.destroy();resolve()})
  })
 })
 await restartWorker()
 assert.equal((await sql("SELECT COUNT(*) AS n FROM porthole_ingest_batches WHERE identity='synthetic-porthole-242'"))[0].n,0,'interruption before a complete request cannot acknowledge or persist a partial envelope')
 const completed=await send('/v1/logs',packet,'synthetic-porthole-242')
 assert.equal(completed.status,200)
 const accepted=await new Promise((resolve,reject)=>{
  const upload=request(origin+'/v1/logs',{method:'POST',headers:{authorization:`Bearer ${secret}`,'content-type':'application/json','content-length':body.length,'x-porthole-batch-id':'synthetic-porthole-243'}},response=>{
   const result={status:response.statusCode,id:response.headers['x-porthole-batch'],duplicate:response.headers['x-porthole-duplicate']}
   response.destroy();upload.destroy();resolve(result)
  })
  upload.on('error',()=>reject(Error('synthetic-porthole-243 interrupted acknowledgement transport failed')))
  upload.end(body)
 })
 assert.equal(accepted.status,200);assert.equal(accepted.duplicate,'false')
 await restartWorker()
 const durable=(await sql(`SELECT id,record_count FROM porthole_ingest_batches WHERE identity=${literal('synthetic-porthole-243')}`))[0]
 assert.equal(durable.id,accepted.id);assert.equal(durable.record_count,1,'durable ack survives lost response and Worker restart')
 const retry=await send('/v1/logs',packet,'synthetic-porthole-243')
 assert.equal(retry.status,200);assert.equal(retry.headers.get('x-porthole-duplicate'),'true');assert.equal(retry.headers.get('x-porthole-batch'),accepted.id)
}
