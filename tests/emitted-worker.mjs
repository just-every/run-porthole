import {createRequire} from 'node:module'
import {readdir} from 'node:fs/promises'
import {dirname,join,resolve} from 'node:path'
import {unstable_getMiniflareWorkerOptions} from 'wrangler'

// Use Wrangler's pinned runtime and binding translation, but serve the emitted
// Worker directly. The dev ProxyWorker adds a second HTTP connection pool:
// its idle-connection close can race a POST after a long archive export. POSTs
// cannot safely be replayed. Runtime journeys need neither that hop nor HMR.
const {Miniflare,convertV4MiniflareOptions}=createRequire(import.meta.resolve('wrangler'))('miniflare')
const {Dispatcher,EnvHttpProxyAgent,getGlobalDispatcher,setGlobalDispatcher}=createRequire(import.meta.resolve('wrangler'))('undici')
export function runtimeTransport() {
 // Each dispatch owns its connection until its response finishes or fails.
 // No later request can borrow a socket workerd is concurrently closing. Keep
 // ordinary streaming/keep-alive framing: forcing Connection: close instead
 // can end a large unread response while Undici's parser is paused.
 const previous=getGlobalDispatcher(),active=new Set(),closing=[]
 let disposed=false
 const terminal=new Set(['onComplete','onError','onUpgrade','onResponseEnd','onResponseError','onRequestUpgrade'])
 const retire=agent=>{
  if(!active.delete(agent))return
  const result=agent.destroy();result.catch(()=>{});closing.push(result)
 }
 const dispatcher=new class extends Dispatcher {
  dispatch(options,handler) {
   if(disposed)throw Error('Runtime transport is closed')
   // Preserve the environment's outbound proxy and NO_PROXY policy.
   const agent=new EnvHttpProxyAgent();active.add(agent)
   const owned=new Proxy(handler,{get(target,key){
    const value=Reflect.get(target,key,target)
    if(typeof value!=='function')return value
    if(!terminal.has(key))return value.bind(target)
    return (...args)=>{try{return value.apply(target,args)}finally{queueMicrotask(()=>retire(agent))}}
   }})
   try{return agent.dispatch(options,owned)}catch(error){retire(agent);throw error}
  }
  async destroy(){disposed=true;for(const agent of active)retire(agent);await Promise.all(closing)}
  close(){return this.destroy()}
 }
 setGlobalDispatcher(dispatcher)
 return async()=>{setGlobalDispatcher(previous);await dispatcher.destroy()}
}
export async function emittedWorker({config,persist,port,inspectorPort,bindings,onLog}) {
 const {workerOptions,main,externalWorkers}=unstable_getMiniflareWorkerOptions(resolve(config))
 const root=dirname(main)
 // The build already emitted every module. Preserve their individual paths
 // and load them without rebundling or watching the output under test.
 const paths=[main,...(await readdir(root,{recursive:true}))
  .filter(path=>path.endsWith('.js')&&!path.split(/[\\/]/).some(part=>part.startsWith('.'))&&resolve(root,path)!==main)
  .map(path=>resolve(root,path))]
 const {modulesRules,...options}=workerOptions
 return new Miniflare(convertV4MiniflareOptions({
  host:'127.0.0.1',port,inspectorPort,
  resourcePersistencePath:join(persist,'v3'),
  handleStructuredLogs:onLog,
  workers:[{...options,modulesRoot:root,modules:paths.map(path=>({type:'ESModule',path})),
   bindings:{...options.bindings,...bindings}},...externalWorkers],
 }))
}
