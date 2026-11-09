import assert from 'node:assert/strict'
import {analyticalTransport} from '/workspace/run-porthole/tests/porthole/analytical-transport.mjs'
import {analyticalEstate} from '/workspace/run-porthole/tests/porthole/analytics.mjs'
import {recipientMailJourney} from '/workspace/run-porthole/tests/porthole/health.mjs'
import {fixture} from '/workspace/run-porthole/tests/porthole/fixture.mjs'
import {passiveNetworkProof} from './network-passive-proof.mjs'
const estate=await analyticalEstate()
try{await recipientMailJourney({bindings:estate.bindings,services:estate.services,run:async ctx=>{
 const {origin,call,post,getDb,restart,sessionSecret,ownerEmail}=ctx,sql=async q=>(await getDb().prepare(q).all()).results,restartWorker=async fn=>{await fn?.();await restart()}
 const helpers=fixture({origin,call,sql,restartWorker,sessionSecret,ownerEmail})
 let cookie=await helpers.freshOwner()
 const configure=async role=>{const c=await(await call('/api/porthole/v1/analytics/configuration',{headers:{cookie}})).json();await post('/api/porthole/v1/analytics/configuration',{revision:c.revision,role,enabled:true,confirm:'connect-analytical-workers'},200,cookie)}
 await configure('primary');await post('/api/porthole/v1/analytics/reconcile',{},200,cookie)
 const proof=await passiveNetworkProof({origin,call,sql,restartWorker,...helpers,analytical:true,browserDispatch:(url,opts)=>call(new URL(url).pathname+new URL(url).search,opts)})
 cookie=await helpers.freshOwner();await configure('standby')
 const response=await call('/api/porthole/v1/network-messaging'+proof.query,{headers:{cookie}});assert.equal(response.status,200);assert.deepEqual(await response.json(),proof.view)
 await estate.stop('standby');assert.equal((await call('/api/porthole/v1/network-messaging'+proof.query,{headers:{cookie}})).status,503);await estate.start('standby')
 console.log('ANALYTICAL PASS primary and standby exact, stopped selected storage returns 503')
}})}finally{await estate.dispose()}
