import type { HealthBindings } from './model'
import { observeHealth } from './observe'
import { evaluateMonitors } from '../recovery/monitors'
import { deliverHealthNotice, reconcileHealthIncidents } from '../recovery/notices'
export { recordComponentReceipt } from './receipts'

/** Worker cron calls this after its real drain/evaluation, never instead of
 * them. No telemetry rewrite and no repair execution occur in this health job. */
export async function healthTick(env: HealthBindings) {
 const monitors=await evaluateMonitors(env)
 const state=await observeHealth(env)
 await reconcileHealthIncidents(env,state)
 const delivery=await deliverHealthNotice(env)
 return {state,delivery,monitors}
}
