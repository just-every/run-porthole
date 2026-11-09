import {spawn} from 'node:child_process'
import {writeFile} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
const repository='/workspace/run-porthole'
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8'}).trim()
const receipt={repository:'just-every/run-porthole',branch:'cloud/sx-porthole-sqlite-busy-1',head,node:process.version,journey:'tests/porthole/archive.mjs#nativeBackupErasureJourney',requested:10,results:[]}
const packet=process.env.HOME+'/rer-consolidation/work/sx-porthole-sqlite-busy-1/packet'
for(let iteration=1;iteration<=10;iteration++){
 const started=new Date().toISOString(),at=performance.now()
 console.log(`JOURNEY_BEGIN iteration=${iteration}/10 head=${head} started=${started}`)
 const child=spawn(process.execPath,['--input-type=module','-e','import {nativeBackupErasureJourney} from "./tests/porthole/archive.mjs"; await nativeBackupErasureJourney()'],{cwd:repository,stdio:['ignore','pipe','pipe'],env:{...process.env,WRANGLER_SEND_METRICS:'false',PORTHOLE_CHROMIUM:'/usr/bin/chromium'}})
 let output=''
 child.stdout.on('data',part=>{process.stdout.write(part);output+=part})
 child.stderr.on('data',part=>{process.stderr.write(part);output+=part})
 const exit=await new Promise((resolve,reject)=>{child.on('exit',(code,signal)=>resolve({code,signal}));child.on('error',reject)})
 const result={iteration,started,finished:new Date().toISOString(),seconds:Number(((performance.now()-at)/1000).toFixed(3)),...exit,passed:exit.code===0&&output.includes('nativeBackupErasureJourney passed:')}
 receipt.results.push(result)
 receipt.passed=receipt.results.filter(r=>r.passed).length
 receipt.failed=receipt.results.filter(r=>!r.passed).length
 await writeFile(packet+'/journey-receipt.json',JSON.stringify(receipt,null,2)+'\n')
 console.log('JOURNEY_END '+JSON.stringify(result))
 if(!result.passed){process.exitCode=1;break}
}
console.log('JOURNEY_TOTAL '+JSON.stringify({head,passed:receipt.passed,failed:receipt.failed,requested:10}))
