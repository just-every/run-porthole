# Changes

## 0.1.0 (27 Nov 2026)

First published release.

- Mail off by default for a hosted installation: `MAIL_PROVIDER=none` needs no sender or mail key, every send is refused with `mail_off` without contacting a provider, and the owner signs in with `rer signin`.
- RER 0.2.143. The demo workflow deploys each published release at its tag.
- The agent door and Business settings are Base 6e207e22's (rer 0.2.143), so the hosted agent-door conformance passes (865/865): auth-first challenge, Business relay and stop, erasure and replay custody. New migrations `0068_agent_door_relay_upgrade.sql` and `0069_business_retired.sql`; `/api/rer/agent-decisions` is routed to the door.
- RELEASE.json lists all 72 migrations (69 core, 3 analytics Worker).
