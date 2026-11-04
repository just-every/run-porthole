import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {once} from 'node:events'
import snappy from 'snappyjs'

// Decode the official prometheus.WriteRequest v1 sample fields independently
// from the product decoder. Snappy is the stock package, not the intake codec.
function fields(buffer) {
 let offset=0
 const integer=()=>{let result=0n,shift=0n;for(let n=0;n<10;n++){assert.ok(offset<buffer.length);const byte=buffer[offset++];result|=BigInt(byte&127)<<shift;if(!(byte&128))return result;shift+=7n}assert.fail('invalid capture integer')}
 const result=[]
 while(offset<buffer.length) {
  const tag=Number(integer()),wire=tag&7;let value
  if(wire===0)value=integer()
  else {
   const length=wire===1?8:wire===5?4:wire===2?Number(integer()):assert.fail('unsupported capture field')
   assert.ok(length>=0&&offset+length<=buffer.length)
   value=buffer.subarray(offset,offset+length);offset+=length
  }
  result.push({number:tag>>3,value})
 }
 return result
}
export async function prometheusCapture() {
 const samples=[],failures=[]
 const server=createServer(async(request,response)=>{
  try {
   assert.equal(request.method,'POST');assert.equal(request.url,'/write')
   assert.equal(request.headers['content-encoding'],'snappy')
   assert.equal(request.headers['x-prometheus-remote-write-version'],'0.1.0')
   const chunks=[];for await(const chunk of request)chunks.push(chunk)
   const message=Buffer.from(snappy.uncompress(Buffer.concat(chunks)))
   for(const item of fields(message).filter(item=>item.number===1)) {
    const series=fields(item.value),labels=Object.fromEntries(series.filter(item=>item.number===1).map(item=>{const pair=fields(item.value);return [pair.find(item=>item.number===1).value.toString(),pair.find(item=>item.number===2).value.toString()]}))
    assert.equal(labels.__name__,'synthetic_porthole_lifecycle','capture accepts only the declared real producer gauge')
    for(const item of series.filter(item=>item.number===2)) {
     const point=fields(item.value),number=point.find(item=>item.number===1)?.value??Buffer.alloc(8),time=point.find(item=>item.number===2)?.value??0n
     const stale=number.readBigUInt64LE()===0x7ff0000000000002n
     assert.ok(stale||Number.isFinite(number.readDoubleLE()))
     samples.push({labels,time:String(time*1000000n),value:stale?null:number.readDoubleLE(),stale})
    }
   }
   response.writeHead(204);response.end()
  }catch(error){failures.push(error);response.writeHead(400);response.end('capture refused')}
 })
 server.listen(0,'127.0.0.1');await once(server,'listening')
 return {origin:'http://127.0.0.1:'+server.address().port,samples,failures,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections()})}
}
