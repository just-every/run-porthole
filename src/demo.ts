// Porthole currently has only the Base foundation: no telemetry or domain records.
// Complete its real first-run state for the owner the demo runtime has created.
import type { Bindings } from './auth.server'

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  await env.DB.prepare("INSERT INTO oa_first_run (singleton, completed_by, completed_at) SELECT 1, id, ? FROM oa_operators WHERE email = ? AND role = 'owner' ON CONFLICT(singleton) DO NOTHING").bind(now.getTime(), ownerEmail).run()
}
