import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'
export async function pipelineBrowser({origin,cookie,definition,planted,empty=false}) {
 const {chromium}=await import('@playwright/test')
 const browser=await chromium.launch({headless:true,...(process.env.PORTHOLE_CHROMIUM_PATH?{executablePath:process.env.PORTHOLE_CHROMIUM_PATH}:{}),args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
 const directory=process.env.PORTHOLE_EVIDENCE_DIR
 try {
  for(const width of [1440,390]) {
   const context=await browser.newContext({viewport:{width,height:width===1440?900:844}})
   await context.addCookies(cookie.split('; ').map(pair=>({name:pair.slice(0,pair.indexOf('=')),value:pair.slice(pair.indexOf('=')+1),url:origin})))
   const page=await context.newPage()
   const snap=async state=>{assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'pipeline reflows');if(directory){await mkdir(directory,{recursive:true});await page.screenshot({path:join(directory,`pipelines-${state}-${width}.png`),fullPage:true})}}
   await page.goto(origin+'/app/settings/members');await page.getByRole('heading',{level:1}).waitFor();await snap('settings-entry')
   await page.getByRole('link',{name:'Log pipelines',exact:true}).click();await page.getByRole('heading',{name:'Log pipelines',exact:true}).waitFor();await snap(empty?'empty':'active')
   if(empty){await context.close();continue}
   await page.getByLabel('Pipeline definition (JSON)').fill(JSON.stringify(definition))
   await page.getByLabel('Sample log bodies (JSON array of strings)').first().fill(JSON.stringify([JSON.stringify({message:'Checkout completed '+planted[0],level:'info'}),'{ malformed }']))
   await page.getByRole('button',{name:'Preview pipeline',exact:true}).click();await page.getByRole('heading',{name:'Review preview',exact:true}).waitFor()
   assert.ok((await page.locator('main').innerText()).includes('json_parse_failed'))
   assert.ok(!(await page.locator('main').innerText()).includes(planted[0]))
   await snap('preview')
   const revision=Number(await page.locator('input[name="revision"]').first().inputValue())
   const changed=await context.request.post(origin+'/api/porthole/v1/pipelines/preview',{headers:{origin},data:{definition,samples:[],revision}});assert.equal(changed.status(),201)
   const current=await changed.json()
   assert.equal((await context.request.post(origin+'/api/porthole/v1/pipelines/activate',{headers:{origin},data:{previewId:current.id,digest:current.digest,confirm:'activate-pipeline'}})).status(),201)
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Activate reviewed pipeline'}).click();await page.getByRole('alert').waitFor();await snap('stale')
   await page.getByRole('button',{name:'Preview pipeline',exact:true}).click();await page.getByRole('heading',{name:'Review preview',exact:true}).waitFor()
   await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Activate reviewed pipeline'}).click();await page.getByRole('status').waitFor();await snap('completed')
   const minimum=await page.locator('main').evaluate(root=>Math.min(...[...root.querySelectorAll('p,label,button,a,summary,pre,dt,dd')].map(el=>Number.parseFloat(getComputedStyle(el).fontSize))))
   assert.ok(minimum>=13,'pipeline text readable')
   await page.getByLabel('Pipeline definition (JSON)').fill('{')
   await page.getByRole('button',{name:'Preview pipeline',exact:true}).click();await page.getByRole('alert').waitFor();await snap('invalid')
   await context.clearCookies();const denied=await page.goto(origin+'/app/settings/pipelines');assert.equal(denied.status(),401);await snap('signed-out')
   assert.equal((await page.goto(origin+'/app/settings/members')).status(),401);await page.getByRole('alert').waitFor();await snap('settings-entry-denied')
   await context.close()
  }
 }finally{await browser.close()}
}
