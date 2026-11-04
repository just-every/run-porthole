import {createServer} from 'node:http'
import {Counter,Gauge,Registry} from 'prom-client'
const registry=new Registry(),labels=['service','environment','team','lane']
const counter=new Counter({name:'synthetic_porthole_requests_total',help:'Completed local work',labelNames:labels,registers:[registry]})
const gauge=new Gauge({name:'synthetic_porthole_queue',help:'Observed local queue',labelNames:labels,registers:[registry]})
let timestamp=0
for(let lane=0;lane<48;lane++) {const scope={service:'checkout-promql',environment:'promql',team:'commerce',lane:String(lane)};counter.inc(scope,0);gauge.set(scope,7+lane)}
const server=createServer(async(request,response)=>{
 const url=new URL(request.url,'http://127.0.0.1')
 if(url.pathname==='/work') {
  const count=Number(url.searchParams.get('count'))
  for(let lane=0;lane<48;lane++)counter.inc({service:'checkout-promql',environment:'promql',team:'commerce',lane:String(lane)},count+lane%3)
  response.end('completed');return
 }
 if(url.pathname==='/sample'){timestamp=Number(url.searchParams.get('at'));response.end('ready');return}
 if(url.pathname==='/metrics') {
  response.setHeader('content-type',registry.contentType)
  response.end((await registry.metrics()).split('\n').map(line=>line&&!line.startsWith('#')?line+' '+timestamp:line).join('\n'));return
 }
 response.statusCode=404;response.end()
})
server.listen(Number(process.argv[2]),'127.0.0.1',()=>process.send?.('ready'))
