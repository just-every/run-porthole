/** Extract pinned stock clients from official, content-addressed images. */
import {execFileSync} from 'node:child_process'
import {mkdirSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve('.cache/standard-clients');mkdirSync(root,{recursive:true})
for(const [image,source,name]of [
 ['prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996','/bin/prometheus','prometheus'],
 ['grafana/tempo-cli@sha256:846aaaca43d2e9e0a08ef7e9bbc355cd1b11d445daee18078930b740ad9902b4','/tempo-cli','tempo-cli'],
]){
 const container=execFileSync('docker',['create',image],{encoding:'utf8',timeout:120000}).trim()
 try{execFileSync('docker',['cp',container+':'+source,resolve(root,name)],{stdio:'inherit',timeout:30000})}
 finally{execFileSync('docker',['rm',container],{stdio:'ignore',timeout:30000})}
}
console.log('Pinned Prometheus 3.5.0 and Tempo CLI 2.8.2 ready')
