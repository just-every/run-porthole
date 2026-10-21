// Porthole currently has only the Base foundation: no telemetry or domain records.
// Complete its real first-run state for the owner the demo runtime has created,
// and give that owner a person's name (the homepage's head of platform and SRE)
// in place of Base's default "Owner".
import type { Bindings } from './auth.server'

export async function seedDemo(env: Bindings, { ownerEmail, now }: { ownerEmail: string; now: Date }): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("UPDATE oa_operators SET display_name = 'Marcus Reed' WHERE email = ? AND role = 'owner' AND display_name = 'Owner'").bind(ownerEmail),
    env.DB.prepare("INSERT INTO oa_first_run (singleton, completed_by, completed_at) SELECT 1, id, ? FROM oa_operators WHERE email = ? AND role = 'owner' ON CONFLICT(singleton) DO NOTHING").bind(now.getTime(), ownerEmail),
  ])
}
