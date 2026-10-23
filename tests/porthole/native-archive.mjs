import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,symlink,rm,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomBytes,randomUUID,createHash} from 'node:crypto'
const execute=promisify(execFile)
const root=process.cwd(),scratch=await mkdtemp(join(tmpdir(),'porthole-native-archive-'))
async function command(cwd,args) {
 try {return await execute(process.execPath,[join(root,'node_modules/@runeditrun/rer/global/rer.mjs'),...args,'--cwd',cwd],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:16*1024*1024})}
 catch(error){const capture=await readFile(join(cwd,'.seed/installer/install.log'),'utf8').catch(()=> '');const safe=(String(error.stdout??'')+'\n'+String(error.stderr??'')+'\n'+capture).replace(/[A-Za-z0-9_+./=-]{32,}/g,'[redacted]').split('\n').slice(-48).join('\n');throw Error(`Native ${args[0]} failed (${error.code})\n${safe}`)}
}
async function clone(name) {
 const directory=join(scratch,name)
 await execute('git',['clone','--quiet','--local','--no-hardlinks',root,directory])
 await execute('git',['-C',directory,'config','user.name','Run Edit Run fleet'])
 await execute('git',['-C',directory,'config','user.email','fleet@runeditrun.com'])
 await symlink(join(root,'node_modules'),join(directory,'node_modules'),'dir')
 return directory
}
async function sql(cwd,statement) {
 const result=await execute(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','foundation','--local','--persist-to',join(cwd,'.wrangler/state'),'--config',join(cwd,'wrangler.jsonc'),'--json','--command',statement],{cwd,env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:8*1024*1024})
 return JSON.parse(result.stdout).flatMap(value=>value.results??[])
}
try {
 const source=await clone('source')
 await command(source,['setup','--owner-email','synthetic-porthole-600@example.com','--non-interactive'])
 console.log('nativeArchiveJourney: source setup passed')
 const owner=(await sql(source,"SELECT id FROM oa_operators WHERE role='owner' AND status='active'"))[0]
 assert.ok(owner)
 const credentialId=randomUUID(),secret=`synthetic-porthole-601-${randomBytes(32).toString('hex')}`,hash=createHash('sha256').update(secret).digest('hex'),now=Date.now(),objectId=randomUUID()
 const scope=JSON.stringify({services:['checkout'],environments:['production'],teams:['commerce'],signals:['logs'],actions:['telemetry.read']})
 // Source-state fixture, not minting evidence: the separate HTTP credential
 // journey proves minting. This command qualifies native archive exclusion.
 await sql(source,`INSERT INTO porthole_credentials(id,name,class,custodian_id,secret_hash,prefix,last_four,scope,created_at,expires_at,requests_per_minute,accepted_bytes_per_minute,scanned_bytes_per_day,usd_micros_per_day) VALUES('${credentialId}','synthetic-porthole-601','read','${owner.id}','${hash}','${secret.slice(0,7)}','${secret.slice(-4)}','${scope}',${now},${now+3600000},600,1048576,1048576,1000000); INSERT INTO porthole_objects VALUES('${objectId}','monitor','synthetic-porthole-602','{"services":["checkout"],"environments":["production"],"teams":["commerce"]}','{"signal":"logs","operator":"above","threshold":2,"windowSeconds":60}',1,'active',${now},${now});`)
 await sql(source,`UPDATE porthole_baggage_policy SET enabled=1,allowed_keys='["region"]',attribute_keys='[]',revision=2,changed_at=${now} WHERE singleton=1`)
 const file=join(source,'exports','installation.rer')
 await command(source,['export','--output',file])
 console.log('nativeArchiveJourney: source export passed')
 const contents=await readFile(file,'utf8')
 for(const privateValue of [secret,hash,'synthetic-porthole-600@example.com'])assert.ok(!contents.includes(privateValue),'native export excludes credential/hash/native identity')
 const sourceAudit=await sql(source,"SELECT entry FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.export.complete'")
 assert.equal(sourceAudit.length,1,'native export result is in private audit')
 const destination=await clone('destination')
 await command(destination,['import','--input',file,'--yes'])
 console.log('nativeArchiveJourney: destination import passed')
 assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_credentials'))[0].n,0)
 assert.equal((await sql(destination,`SELECT state FROM porthole_objects WHERE id='${objectId}'`))[0].state,'quarantined')
 assert.equal((await sql(destination,'SELECT paused FROM porthole_ingest_control'))[0].paused,1)
 assert.deepEqual((await sql(destination,'SELECT enabled,allowed_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'["region"]'},'native restore retains policy lists without forwarding authority')
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM oa_operators"))[0].n,0,'source native identities do not block the destination bootstrap')
 assert.equal((await sql(destination,`SELECT state FROM porthole_archive_actors WHERE actor_ref='${owner.id}'`))[0].state,'inactive','source actor metadata remains opaque and inactive')
 await command(destination,['setup','--owner-email','synthetic-porthole-603@example.com','--non-interactive'])
 const newOwner=(await sql(destination,"SELECT id FROM oa_operators WHERE email='synthetic-porthole-603@example.com' AND role='owner' AND status='active'"))[0]
 assert.ok(newOwner && newOwner.id!==owner.id,'destination has its own new native owner')
 assert.equal((await sql(destination,'SELECT paused FROM porthole_ingest_control'))[0].paused,1)
 assert.deepEqual((await sql(destination,'SELECT enabled,allowed_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'["region"]'},'native restore retains policy lists without forwarding authority')
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.import.complete'"))[0].n,1,'native restore fact is captured in its durable job transaction')
 const before=(await sql(destination,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n
 await assert.rejects(()=>command(destination,['import','--input',file,'--yes']),/refus|empty|occupied|failed/i)
 assert.equal((await sql(destination,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,before)
 assert.equal((await sql(destination,"SELECT COUNT(*) AS n FROM porthole_audit_entries WHERE json_extract(entry,'$.action')='installation.import.command' AND json_extract(entry,'$.phase')='failed'"))[0].n,1,'native refusal is privately audited without importing product data')
 // Export integrity alone must not authorize an invalid owner policy. Exercise
 // the native command with intact, independently generated malformed archives.
 for(const [name,allowed,attributes] of [
  ['object',{},[]],['duplicate',['region','region'],[]],
  ['attribute-scope',['region'],['customer']],['invalid-key',['Region'],[]],
 ]) {
  await sql(source,`UPDATE porthole_baggage_policy SET allowed_keys='${JSON.stringify(allowed)}',attribute_keys='${JSON.stringify(attributes)}' WHERE singleton=1`)
  const malformed=join(source,'exports',`invalid-${name}.rer`)
  await command(source,['export','--output',malformed])
  const refused=await clone(`refused-${name}`)
  await assert.rejects(()=>command(refused,['import','--input',malformed,'--yes']),/staged_validation|failed/i)
  assert.equal((await sql(refused,'SELECT COUNT(*) AS n FROM porthole_objects'))[0].n,0,'invalid staged policy publishes no domain objects')
  assert.deepEqual((await sql(refused,'SELECT enabled,allowed_keys,attribute_keys FROM porthole_baggage_policy'))[0],{enabled:0,allowed_keys:'[]',attribute_keys:'[]'},'refusal preserves the inactive destination default')
 }
 console.log('nativeArchiveJourney passed: real rer setup/export/empty restore, excluded credential/hash/identity, inactive authority, semantic policy refusal and durable CLI audit')
} finally {await rm(scratch,{recursive:true,force:true})}
