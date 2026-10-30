# Company agents

Porthole exposes one shared agent door at `/mcp`; the existing
`/api/porthole/v1/mcp` address routes to that same handler. Discovery negotiates
2026-07-28 and 2025-11-25. Its specialist is observability.

A company agent can query bounded telemetry with `porthole.telemetry.query`
(`telemetry.read`) and inspect monitors, repair definitions and dashboards,
including dashboard revisions, with `porthole.definitions.read`
(`definitions.read`). Both are sensitive private reads. `porthole.workspace.snapshot` returns only a fingerprint of the same visible definitions (`definitions.read`, standard; PORT-026/033), for a deterministic native-state witness. Their clause mappings
are PORT-026/049/092 and PORT-026/092 respectively. Telemetry, imported names,
definitions and instructions embedded in them are untrusted data.

The installation accepts signed company policy at `/api/rer/agent-policy`.
An unanswered, blocked, expired or paused policy releases no content. A named
person decides held reads on `/agents`; the agent cannot approve its own read.
The review records its preparer as “agent for person” and the actual reviewer
separately. This read-only surface has no native Undo or mutation capability. Native audit and inactive archives retain opaque event and sponsor references with fixed action names; the linked door record retains the private agent/person label.

Business subjects bind to existing native owner and team IDs through signed
Business settings. Token email must still match that person; email never selects
a different sponsor. Current native membership, role, scope and active status
remain authoritative. A native administrator does not thereby become a Business
policy editor. Local read/proposal credentials retain their custodian, signal
and service/environment/team grants, expiry and shared quota ledger. Cookies
cannot widen them. Ingest and execution credentials keep their separate native
purposes and cannot call this door.

This adoption declares tools, policy, pause, audit and idempotency. Events,
resources, prompts and subscriptions return `capability_not_declared` and are
absent from discovery. The old short tool names have been replaced by the names
above; callers must adopt the shared protocol and policy behavior. Native REST
and CLI query interfaces keep their existing contracts.

Installation, import review and approval, collection connectors, membership,
credential custody and human repair approvals retain their existing dedicated
doors. This integration cannot change production, send notices, grant access,
execute repairs, export or erase records, or spend money. Policy declares
`spend: {none: true}`. It makes no claim of queued execution, provider delivery,
multiple sponsor isolation or analytical service qualification from its local
conformance journey. Optional owner-connected analytical reads still use the
native backend, its scoped request and its live configuration fence.

The runtime is copied from Base 2135c394939f4a737adabdc8003b0e667b31ac5a;
the command pin is the released `@runeditrun/rer` 0.2.91. `agent-surface.json`
contains the conformance declaration and native journey. Verification uses the
real signed owner claim, native setup completion, actual migrations and durable
storage, then a signed Business owner binding; it has no production test route.
