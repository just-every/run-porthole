import {randomUUID} from 'node:crypto'
import {localPortability} from '@runeditrun/rer/portability'

/** Keep the shared transfer format, migration safety and operation lock. The
 * edition projects its durable native job facts around the shared command. */
export function nativePortability() {
 const base=localPortability({database:'foundation',policyModule:'scripts/porthole/archive-policy.mjs',transient:['local runtime caches and logs']})
 const project=(context,event)=>context.store.run('Recording private archive audit',process.execPath,['--experimental-strip-types','--disable-warning=ExperimentalWarning','scripts/porthole/project-native-audit.mjs',...(event?[JSON.stringify(event)]:[])],{cwd:context.root,signal:context.signal,env:{...process.env,WRANGLER_SEND_METRICS:'false'}})
 return {...base,
  async export(context) {
   await context.store.run('Applying archive audit migrations','pnpm',['exec','wrangler','d1','migrations','apply','foundation','--local','--persist-to','.wrangler/state','--config','wrangler.jsonc'],{cwd:context.root,signal:context.signal,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG:'warn'}})
   await project(context)
   const event={operationRef:randomUUID(),kind:'export',occurredAt:Date.now()}
   try {const result=await base.export(context);await project(context,{...event,phase:'succeeded'});return result}
   catch(error) {await project(context,{...event,phase:'failed'});throw error}
  },
  async import(context) {
   const event={operationRef:randomUUID(),kind:'import',occurredAt:Date.now()}
   try {const result=await base.import(context);await project(context,{...event,phase:'succeeded'});return result}
   catch(error) {await project(context,{...event,phase:'failed'});throw error}
  },
 }
}
