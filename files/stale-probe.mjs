import assert from 'node:assert/strict'
import {writeFile} from 'node:fs/promises'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {networkEstate} from '/workspace/run-porthole/tests/porthole/network/estate.mjs'
import {form} from '/workspace/run-porthole/tests/porthole/fixture.mjs'
const execute=promisify(execFile),wait=ms=>new Promise(r=>setTimeout(r,ms))
export async function staleReplayProbe({origin,freshOwner}) {
 const cookie=await freshOwner(),rejected=[]
 const post=async(path,data,status=200)=>{const r=await fetch(origin+path,form(origin,cookie,data));assert.equal(r.status,status,await r.clone().text());return r.json()}
 const source=await post('/app/settings/credentials/mint',{name:'Owned stale metric reproduction',class:'ingest',scope:{services:['checkout-kafka','fulfillment-kafka','checkout-rabbitmq','fulfillment-rabbitmq'],environments:['production'],teams:['commerce'],signals:['traces','metrics'],actions:['telemetry.write']}},201)
 const dispatch=async(path,options)=>{const r=await fetch(origin+path,options);if(path==='/v1/metrics'&&r.status===400)rejected.push({body:Buffer.from(options.body),type:options.headers['content-type'],error:await r.clone().text()});return r}
 const estate=await networkEstate({dispatch,secret:source.secret})
 try {
  const {tag}=await estate.start()
  await estate.app('checkout-kafka','/work?count=1&window=stale-reproduction')
  await wait(6000)
  await execute('docker',['stop',tag+'-node-exporter'])
  for(let pass=0;pass<25&&!rejected.length;pass++)await wait(1000)
  assert.ok(rejected.length,'the actual stock receiver emitted the refused withdrawal packet')
  const packet=rejected[0],data=JSON.parse(packet.body)
  const points=data.resourceMetrics.flatMap(r=>r.scopeMetrics.flatMap(s=>s.metrics.flatMap(m=>Object.entries(m).filter(([k,v])=>v?.dataPoints).flatMap(([kind,v])=>v.dataPoints.map(p=>({name:m.name,kind,flags:p.flags,hasAsDouble:Object.hasOwn(p,'asDouble'),hasAsInt:Object.hasOwn(p,'asInt')}))))))
  const replay=await fetch(origin+'/v1/metrics',{method:'POST',headers:{authorization:'Bearer '+source.secret,'content-type':packet.type},body:packet.body}),error=await replay.clone().text()
  const root='/home/agent/rer-consolidation/work/sx-porthole-c-f466-pc1/packet/'
  await writeFile(root+'stock-no-value-otlp.json',JSON.stringify(data,null,2)+'\n')
  await writeFile(root+'stock-no-value-reproduction.json',JSON.stringify({head:process.env.PORTHOLE_PROBE_HEAD,collector:'unmodified pinned Contrib Prometheus receiver',action:'stopped the owned namespace node exporter after successful scrapes',firstResponse:400,firstError:packet.error,replayResponse:replay.status,replayError:error,points},null,2)+'\n')
  console.log('Stock withdrawal point shapes: '+JSON.stringify(points))
  await post('/app/settings/credentials/revoke',{id:source.credential.id})
  assert.equal(replay.status,200,error)
 } finally {await estate.stop()}
}
