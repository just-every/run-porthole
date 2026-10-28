import {readFile, mkdir, writeFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createServer} from 'vite'

const root=fileURLToPath(new URL('../../',import.meta.url))
const target=new URL('../../public/openapi/porthole-v1.json',import.meta.url)
const args=process.argv.slice(2)
if(args.some(arg=>arg!=='--check')||args.length>1)throw new Error('Usage: node scripts/porthole/public-schema.mjs [--check]')
const server=await createServer({root,configFile:false,server:{middlewareMode:true,watch:null},appType:'custom'})
let document
try {
 const {openapi}=await server.ssrLoadModule('/src/porthole/api/openapi.ts')
 document=JSON.stringify(openapi,null,2)+'\n'
} finally {await server.close()}
if(args.includes('--check')) {
 let current
 try {current=await readFile(target,'utf8')} catch(error) {if(error.code!=='ENOENT')throw error}
 if(current!==document)throw new Error('Public API schema is stale. Run node scripts/porthole/public-schema.mjs')
 console.log('Public API schema is current.')
} else {
 await mkdir(new URL('.',target),{recursive:true})
 await writeFile(target,document)
 console.log('Generated public/openapi/porthole-v1.json')
}
