import type {Bindings} from '../../auth.server'
import {fail,type Authority} from '../security/authority'
import {definition,type Handoff} from './model'
export async function handoffs(env:Bindings,actor:Authority):Promise<Handoff[]> {
 const rows=(await env.DB.prepare(`SELECT v.* FROM porthole_handoff_versions v WHERE revision=(SELECT MAX(revision) FROM porthole_handoff_versions WHERE product=v.product) AND ${actor.fence} ORDER BY product`).bind(...actor.args).all<Handoff>()).results
 if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
 // Keep the revision so the owner can replace an unsafe legacy declaration,
 // while no reader receives either of its URL fields.
 return rows.map(row=>{try{definition({...row});return row}catch{return {...row,destination:'',template:'',state:'quarantined'}}})
}
