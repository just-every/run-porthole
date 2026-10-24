import assert from 'node:assert/strict'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtemp,mkdir,copyFile,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir,platform,arch} from 'node:os'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {form} from './fixture.mjs'
const execute=promisify(execFile),source='registry.terraform.io/just-every/porthole'
/** Actual Terraform executable, compiled SDK provider and emitted product Worker. */
export async function terraformJourney({origin,cookie,freshOwner}) {
 cookie=await freshOwner()
 const directory=await mkdtemp(join(tmpdir(),'porthole-terraform-')),binary=process.env.PORTHOLE_TERRAFORM??'terraform',provider=resolve(process.env.PORTHOLE_TERRAFORM_PROVIDER??'.cache/toolchains/terraform-provider-porthole')
 const scope={services:['checkout'],environments:['production'],teams:['commerce']},from=String((BigInt(Date.now())-3600000n)*1000000n),through=String(BigInt(Date.now())*1000000n)
 const monitor={name:'Checkout Terraform error monitor',scope,body:{signal:'logs',operator:'above',threshold:3,windowSeconds:300}}
 const dashboard={name:'Checkout Terraform dashboard',scope,body:{variables:{team:'commerce',environment:'production'},range:{from,through},annotations:[],panels:[{id:'errors',title:'Checkout errors',service:'checkout',signal:'logs',aggregate:'count',unit:'records'}]}}
 const post=(path,data,extra={})=>fetch(origin+path,{...form(origin,cookie,data),headers:{...form(origin,cookie,data).headers,...extra}})
 const get=async(path)=>{const response=await fetch(origin+path,{headers:{cookie}});assert.equal(response.status,200);return response.json()}
 const configuration={terraform:{required_providers:{porthole:{source,version:'0.1.0'}}},provider:{porthole:{origin}},resource:{porthole_monitor:{imported:{name:monitor.name,scope_json:JSON.stringify(scope),definition_json:JSON.stringify(monitor.body)}},porthole_dashboard:{imported:{name:dashboard.name,scope_json:JSON.stringify(scope),definition_json:JSON.stringify(dashboard.body)}}}}
 const save=()=>writeFile(join(directory,'main.tf.json'),JSON.stringify(configuration,null,2))
 try {
  const target=join(directory,'providers',source,'0.1.0',platform()==='darwin'?'darwin_'+(arch()==='arm64'?'arm64':'amd64'):'linux_'+(arch()==='arm64'?'arm64':'amd64'))
  await mkdir(target,{recursive:true});await copyFile(provider,join(target,'terraform-provider-porthole_v0.1.0'))
  const cliConfig=join(directory,'terraform.rc')
  await writeFile(cliConfig,`provider_installation {\n filesystem_mirror {\n path = ${JSON.stringify(join(directory,'providers'))}\n include = [${JSON.stringify(source)}]\n }\n}\n`)
  const env={...process.env,TF_CLI_CONFIG_FILE:cliConfig,TF_IN_AUTOMATION:'1',TF_INPUT:'0',TF_LOG:'',TF_LOG_PATH:'',PORTHOLE_SESSION:cookie,GOMAXPROCS:'2'}
  const tf=async(args,expected=0)=>{
   const result=await execute(binary,['-chdir='+directory,...args],{env,maxBuffer:4*1024*1024}).then(value=>({...value,code:0}),error=>({stdout:error.stdout??'',stderr:error.stderr??'',code:error.code}))
   for(const secret of [cookie,...cookie.split('; ').map(part=>part.slice(part.indexOf('=')+1))])assert.ok(!result.stdout.includes(secret)&&!result.stderr.includes(secret),'Terraform output excludes native authority')
   assert.equal(result.code,expected,result.stdout+'\n'+result.stderr)
   return result
  }
  const imported={}
  for(const [kind,input,path]of [['monitor',monitor,'/api/porthole/v1/configuration/monitors'],['dashboard',dashboard,'/api/porthole/v1/dashboards']]) {
   const response=await post(path,input,{'idempotency-key':randomUUID()});assert.equal(response.status,201);imported[kind]=await response.json()
  }
  await save();await tf(['init','-no-color']);
  await tf(['import','-no-color','porthole_monitor.imported',imported.monitor.id]);await tf(['import','-no-color','porthole_dashboard.imported',imported.dashboard.id])
  await tf(['plan','-no-color','-detailed-exitcode'])
  configuration.resource.porthole_monitor.created={...configuration.resource.porthole_monitor.imported,name:'Checkout Terraform created monitor'}
  configuration.resource.porthole_dashboard.created={...configuration.resource.porthole_dashboard.imported,name:'Checkout Terraform created dashboard'}
  await save();await tf(['apply','-no-color','-auto-approve','-parallelism=2']);await tf(['plan','-no-color','-detailed-exitcode'])
  let previousMonitorName=monitor.name,previousDashboardName=dashboard.name
  for(const width of [1440,390]) {
   const nextMonitor='Checkout Terraform planned monitor '+width,nextDashboard='Checkout Terraform planned dashboard '+width
   configuration.resource.porthole_monitor.imported.name=nextMonitor;configuration.resource.porthole_dashboard.imported.name=nextDashboard
   await save();await tf(['plan','-no-color','-out=saved.tfplan'])
   const nativeMonitor='Checkout Terraform native monitor '+width,nativeDashboard='Checkout Terraform native dashboard '+width
   await nativeEdits({origin,cookie,width,monitorId:imported.monitor.id,dashboardId:imported.dashboard.id,previousMonitorName,previousDashboardName,nativeMonitor,nativeDashboard})
   const refused=await execute(binary,['-chdir='+directory,'apply','-no-color','-parallelism=2','saved.tfplan'],{env,maxBuffer:4*1024*1024}).then(()=>null,error=>error)
   assert.ok(refused&&refused.code!==0,'saved stale plan refuses')
   assert.match(refused.stderr,/revision_conflict|revision_or_authority_changed/)
   assert.equal((await get('/api/porthole/v1/configuration/monitors/'+imported.monitor.id)).name,nativeMonitor)
   assert.equal((await get('/api/porthole/v1/dashboards/'+imported.dashboard.id)).name,nativeDashboard)
   configuration.resource.porthole_monitor.imported.name=nativeMonitor;configuration.resource.porthole_dashboard.imported.name=nativeDashboard
   await save();await tf(['plan','-no-color','-detailed-exitcode'])
   // A reviewed new plan applies one intended native change for each family.
   configuration.resource.porthole_monitor.imported.name=nextMonitor;configuration.resource.porthole_dashboard.imported.name=nextDashboard
   await save();await tf(['apply','-no-color','-auto-approve','-parallelism=2']);await tf(['plan','-no-color','-detailed-exitcode'])
   previousMonitorName=nextMonitor;previousDashboardName=nextDashboard
  }
  const state=await readFile(join(directory,'terraform.tfstate'),'utf8');assert.ok(!state.includes(cookie)&&!state.includes('PORTHOLE_SESSION'))
  const current=JSON.parse((await tf(['show','-json'])).stdout).values.root_module.resources
  const created=current.filter(row=>row.name==='created')
  delete configuration.resource.porthole_monitor.created;delete configuration.resource.porthole_dashboard.created
  await save();await tf(['apply','-no-color','-auto-approve','-parallelism=2']);await tf(['plan','-no-color','-detailed-exitcode'])
  for(const row of created) {
   const path=row.type==='porthole_monitor'?'/api/porthole/v1/configuration/monitors/':'/api/porthole/v1/dashboards/'
   assert.equal((await get(path+row.values.id)).state,'archived','destroy retains native history with no live definition')
  }
  console.log('Terraform journey passed: real provider import/create/update/refresh, zero-drift plans, concurrent native edits and stale-plan refusal at both widths, environment-only auth and explicit archive on destroy')
 }finally{await rm(directory,{recursive:true,force:true})}
}
async function nativeEdits({origin,cookie,width,monitorId,dashboardId,previousMonitorName,previousDashboardName,nativeMonitor,nativeDashboard}) {
 const {chromium}=await import('@playwright/test'),browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 try {
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
  await context.addCookies(cookie.split('; ').map(v=>({name:v.slice(0,v.indexOf('=')),value:v.slice(v.indexOf('=')+1),url:origin})))
  const page=await context.newPage();await page.goto(origin+'/app/operations')
  const article=page.getByRole('article').filter({has:page.getByRole('heading',{name:previousMonitorName,exact:true})});await article.getByText('Edit monitor',{exact:true}).click()
  const edit=article.locator('form[action="/app/operations/save"]');await edit.getByLabel('Name',{exact:true}).fill(nativeMonitor);await edit.getByRole('button',{name:'Save new revision'}).click();await page.getByRole('heading',{name:nativeMonitor,exact:true}).waitFor()
  if(process.env.PORTHOLE_EVIDENCE_DIR){await mkdir(process.env.PORTHOLE_EVIDENCE_DIR,{recursive:true});await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`terraform-monitor-${width}.png`),fullPage:true})}
  await page.goto(origin+'/app/dashboards/'+dashboardId);await page.getByRole('heading',{name:previousDashboardName,exact:true}).waitFor();await page.getByText('Edit dashboard',{exact:true}).click()
  const dashboard=page.locator('form[action="/app/dashboards/save"]');await dashboard.getByLabel('Name',{exact:true}).fill(nativeDashboard);await dashboard.getByRole('button',{name:'Save new revision'}).click();await page.getByRole('heading',{name:nativeDashboard,exact:true}).waitFor()
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
  if(process.env.PORTHOLE_EVIDENCE_DIR)await page.screenshot({path:join(process.env.PORTHOLE_EVIDENCE_DIR,`terraform-dashboard-${width}.png`),fullPage:true})
 }finally{await browser.close()}
}
