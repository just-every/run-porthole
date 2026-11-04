import assert from 'node:assert/strict'
import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {createServer} from 'node:net'
import {once} from 'node:events'
import {mkdtemp,mkdir,readFile,writeFile,rm,access} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const execute=promisify(execFile)
// Official 3.5.0 release archive digests, checked before extracting the reference.
const archives={
 'linux-x64':['linux-amd64','e811827af26d822afb09a4f28314f61b618b12cff5369835a67f674d8b46f39a'],
 'linux-arm64':['linux-arm64','173389cc42bf09c4e6e54cb53fa07a5a835d7c261e14775d2183181d6e385d1c'],
 'darwin-arm64':['darwin-arm64','c17bc2c992f0b5515eebe2b4ccd626214f8e309a0fe6ec40ed13c42ec13d05fb'],
 'darwin-x64':['darwin-amd64','5856d0c306e7d852d9a79788b20acb630501b3fab120b69f5317d6b0732dea57'],
}
export async function referenceBinary() {
 const [target,digest]=archives[process.platform+'-'+process.arch]??[];assert.ok(target,'supported stock reference platform')
 const directory=resolve('.cache/toolchains'),binary=join(directory,'prometheus-3.5.0.'+target,'prometheus')
 try{await access(binary);return binary}catch{}
 await mkdir(directory,{recursive:true})
 const archive=join(directory,'prometheus-3.5.0.'+target+'.tar.gz')
 await execute('curl',['--fail','--location','--silent','--show-error','--max-time','180','https://github.com/prometheus/prometheus/releases/download/v3.5.0/prometheus-3.5.0.'+target+'.tar.gz','--output',archive])
 assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),digest,'official reference archive digest')
 await execute('tar',['-xzf',archive,'-C',directory]);return binary
}
async function port(){const socket=createServer();socket.listen(0,'127.0.0.1');await once(socket,'listening');const number=socket.address().port;await new Promise(resolve=>socket.close(resolve));return number}
async function stop(child){if(child&&child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited}}
async function until(check,message){for(let n=0;n<160;n++){if(await check())return;await delay(100)}assert.fail(message)}
const ns=seconds=>{const [whole,fraction='']=String(seconds).split('.');return whole+fraction.padEnd(9,'0')}
export const seconds=nanoseconds=>{const n=BigInt(nanoseconds);return String(n/1000000000n)+'.'+String(n%1000000000n).padStart(9,'0')}
export async function prometheusReference() {
 const binary=await referenceBinary(),scratch=await mkdtemp(join(tmpdir(),'synthetic-porthole-promql-')),producerPort=await port(),referencePort=await port()
 const origin='http://127.0.0.1:'+referencePort,producerOrigin='http://127.0.0.1:'+producerPort
 let producer,server,logs=''
 const t=Date.now()-120000
 const query=async(expression,settings)=>{
  const params=new URLSearchParams({query:expression,lookback_delta:String(settings.lookback??300)+'s'})
  if(settings.time)params.set('time',seconds(settings.time))
  else {params.set('start',seconds(settings.start));params.set('end',seconds(settings.end));params.set('step',String(settings.step))}
  const response=await fetch(origin+'/api/v1/'+(settings.time?'query':'query_range')+'?'+params)
  assert.equal(response.status,200,await response.clone().text());const body=await response.json();assert.equal(body.status,'success');return body.data
 }
 const startProducer=async()=>{producer=spawn(process.execPath,[new URL('./promql-producer.mjs',import.meta.url).pathname,String(producerPort)],{stdio:['ignore','ignore','pipe','ipc']});producer.stderr.on('data',chunk=>logs+=chunk);await once(producer,'message')}
 try {
  await startProducer()
  const config=join(scratch,'prometheus.yml')
  await writeFile(config,`global:\n  scrape_interval: 200ms\n  scrape_timeout: 150ms\nscrape_configs:\n  - job_name: synthetic-porthole-3100\n    honor_timestamps: true\n    static_configs:\n      - targets: ['127.0.0.1:${producerPort}']\n`)
  server=spawn(binary,['--config.file='+config,'--storage.tsdb.path='+join(scratch,'data'),'--web.listen-address=127.0.0.1:'+referencePort,'--web.enable-remote-write-receiver'],{stdio:['ignore','pipe','pipe']})
  for(const stream of [server.stdout,server.stderr])stream.on('data',chunk=>logs=(logs+chunk).slice(-10000))
  await until(async()=>{try{return (await fetch(origin+'/-/ready')).ok}catch{return false}},'stock reference readiness: '+logs)
  for(const [index,count] of [4,6,2,1,3,8].entries()) {
   if(index===3){await stop(producer);await startProducer()}
   assert.equal((await fetch(producerOrigin+'/work?count='+count)).status,200)
   const at=t+index*10000
   await fetch(producerOrigin+'/sample?at='+at)
   await until(async()=>{
    const data=await query('synthetic_porthole_requests_total[1h]',{time:String(BigInt(at)*1000000n)})
    return data.result.length===48&&data.result.every(series=>series.values.at(-1)[0]===at/1000)
   },'reference scraped actual producer stage '+index+': '+logs)
  }
  const end=String(BigInt(t+50000)*1000000n),settings={time:end},series=[]
  for(const name of ['synthetic_porthole_queue','synthetic_porthole_requests_total']) {
   const data=await query(name+'[1h]',settings)
   assert.equal(data.result.length,48)
   for(const row of data.result){assert.equal(row.values.length,6,'every controlled producer sample was scraped');series.push({labels:row.metric,kind:name.endsWith('_total')?'counter':'gauge',unit:name.endsWith('_total')?'requests':'items',samples:row.values.map(([time,value])=>({time:ns(time),value:Number(value)}))})}
  }
  assert.ok(series.filter(row=>row.kind==='counter').every(row=>row.samples[3].value<row.samples[2].value),'actual process reset lowered every cumulative series')
  const cases=[
   {expression:'synthetic_porthole_queue',settings:{time:end}},
   {expression:'synthetic_porthole_queue{lane="2"}',settings:{start:String(BigInt(t)*1000000n),end,step:7}},
   {expression:'sum by (team) (synthetic_porthole_queue)',settings:{time:end}},
   {expression:'rate(synthetic_porthole_requests_total[30s])',settings:{time:end}},
   {expression:'increase(synthetic_porthole_requests_total[30s])',settings:{time:end}},
   {expression:'sum by (service) (rate(synthetic_porthole_requests_total[30s]))',settings:{start:String(BigInt(t+20000)*1000000n),end,step:10}},
   {expression:'synthetic_porthole_queue{lane="missing"}',settings:{time:end}},
   {expression:'synthetic_porthole_queue{absent=""}',settings:{time:end}},
   {expression:'synthetic_porthole_queue',settings:{time:String(BigInt(t+55000)*1000000n),lookback:5}},
  ]
  for(const item of cases)item.expected=await query(item.expression,item.settings)
  return {origin,t,end,series,cases,query,close:async()=>{await stop(producer);await stop(server);await rm(scratch,{recursive:true,force:true})}}
 }catch(error){await stop(producer);await stop(server);await rm(scratch,{recursive:true,force:true});error.message+='\n'+logs;throw error}
}
