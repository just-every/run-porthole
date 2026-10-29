import assert from 'node:assert/strict'
/** Native owner configuration for existing independently operated journeys. */
export async function localAgentPolicy(origin,cookie) {
 const response=await fetch(origin+'/agents/api/policy',{method:'PUT',headers:{origin,cookie,'content-type':'application/json'},body:JSON.stringify({document:{schema:'rer-agent-policy/1',catalogue:'rer-agent-classes/1',rules:[{id:'owner-approved-reads',class:'*',do:'autonomous'}],spend:{none:true}}})})
 assert.equal(response.status,200,await response.clone().text())
 assert.equal((await response.json()).complete,true)
}
export const refusal=body=>body.result?._meta?.['com.runeditrun/error']?.code??body.error?.data?.code
