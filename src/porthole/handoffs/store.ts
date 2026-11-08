import type {Bindings} from '../../auth.server'
import {fail,type Authority} from '../security/authority'
import type {Handoff} from './model'
export async function handoffs(env:Bindings,actor:Authority):Promise<Handoff[]> {
 const rows=(await env.DB.prepare(`SELECT v.* FROM porthole_handoff_versions v WHERE revision=(SELECT MAX(revision) FROM porthole_handoff_versions WHERE product=v.product) AND ${actor.fence} ORDER BY product`).bind(...actor.args).all<Handoff>()).results
 if(!await env.DB.prepare(`SELECT 1 WHERE ${actor.fence}`).bind(...actor.args).first())fail('authority_changed',409)
 return rows
}
