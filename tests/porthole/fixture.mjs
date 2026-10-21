import assert from 'node:assert/strict'
import {randomBytes,randomUUID} from 'node:crypto'
import {ownerSigninDigest} from '../../src/modules/operator-auth/owner-signin-grant.mjs'
import {hashToken} from '../../src/modules/operator-auth/crypto.mjs'

export const form=(origin,cookie,data)=>({method:'POST',redirect:'manual',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify(data)})
export const literal=value=>`'${String(value).replaceAll("'","''")}'`
export function fixture({origin,sql,restartWorker,sessionSecret,ownerEmail='owner@example.com'}) {
 const read=statement=>sql(statement)
 async function mutate(statement) {await restartWorker(()=>sql(statement))}
 async function freshOwner() {
  // Network-edge substitute for the owner's rer-signin grant, not a session
  // fake: the real public confirmation consumes it and issues the session.
  const token=randomBytes(32).toString('base64url'),now=Date.now()
  await mutate(`INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at) SELECT ${literal(randomUUID())},${literal(await ownerSigninDigest(token))},id,version,${now},${now+120000} FROM oa_operators WHERE email=${literal(ownerEmail)};`)
  const response=await fetch(origin+'/auth/owner-signin',form(origin,'',{token}))
  assert.equal(response.status,303,'owner link confirmation')
  return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
 }
 async function link(email,{kind='magic',expired=false}={}) {
  const token=randomBytes(32).toString('base64url'),now=Date.now()
  // The mail-edge fixture has the raw token; storage contains only the keyed
  // digest in Base's actual schema. Link use itself always goes through HTTP.
  const digest=await hashToken(sessionSecret,'link',token)
  await mutate(`INSERT INTO oa_tokens(id,token_hash,kind,operator_id,operator_version,issuer_id,issuer_version,return_to,created_at,expires_at)
   SELECT ${literal(randomUUID())},${literal(digest)},${literal(kind)},o.id,o.version,${kind==='invite'?"a.id":"NULL"},${kind==='invite'?"a.version":"NULL"},'/app',${now},${expired?now-1:now+120000} FROM oa_operators o,oa_operators a WHERE o.email=${literal(email)} AND a.email=${literal(ownerEmail)};`)
  return token
 }
 async function signIn(email) {
  const kind=(await sql(`SELECT status FROM oa_operators WHERE email=${literal(email)}`))[0]?.status==='invited'?'invite':'magic'
  const token=await link(email,{kind}),response=await fetch(origin+'/auth/confirm',form(origin,'',{token}))
  assert.equal(response.status,303,'native email confirmation')
  return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
 }
 return {sql:read,mutate,freshOwner,link,signIn}
}
