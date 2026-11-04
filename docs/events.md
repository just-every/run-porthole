# Native custom events

Open `/app/events` to search custom execution evidence by source, original
source ID, service, environment, team, severity, text, correlation and inclusive
Unix-nanosecond time bounds. Open Event settings to submit a custom event as a
current native owner. Reads use current native membership and all three scopes;
finance readers and bearer credentials cannot use these doors. An owner cookie
does not override a supplied bearer credential.

`POST /api/porthole/v1/events` accepts `source`, `sourceId`, `title`, `service`,
`environment`, `team`, `severity` and `occurredAt`, plus optional `text`,
`resource`, `tags` and `correlationKey`. Severity is info, warning or error.
The static OpenAPI document describes the bounds. Provenance is always
`native-custom`, attributed to the current native actor and member revision.
Custom source labels do not establish authenticated provider provenance.
Provider types, supplied actor or receipt fields and effect instructions refuse.
Creating an event never evaluates a monitor, sends a message or publishes status.

A source and source ID identify one logical event. An identical retry by the
original actor returns the same ID, original occurrence and receipt times and
content digest, with `replayed: true`. Changed content or another actor conflicts.
There is no event-edit operation.

`GET /api/porthole/v1/events` returns `events`, `snapshot` and `cursor`. Use the
opaque cursor with the identical search and session. Each page rechecks current
scope; changed membership invalidates the cursor. Ordering is occurrence time,
then event ID, at a fixed receipt-sequence snapshot. A newly received late event
appears in a fresh search, preserving its original occurrence time. Use
`GET /api/porthole/v1/events/{id}` to read one event. Unknown query fields,
repeated fields, invalid cursors and unsupported requests return explicit errors.
An unavailable store never becomes an empty successful result.

Save a filter privately from Events, or use the versioned `/api/porthole/v1/events/filters` door.
A change requires its exact current revision. Filters contain query definitions,
not cached event content. They confer no authority and remain private to the
saving member. Every use reapplies current scope.

Private dashboards accept an optional `eventOverlays` array of event IDs.
The existing dashboard editor can add or remove an authorized reference.
Saving checks both native event access and the dashboard’s scope. Each graph’s
timeline resolves references again using current native access, selected service,
team, environment and time range. Time-series and heatmap graphs mark original event times on their existing time axes; other widgets retain the private reference timeline. An unavailable reference shows no event content.
Definition credentials receive no event references or resolved content. A new
overlay revision invalidates earlier public addresses by the existing source
revision fence; removing an overlay cannot revive them. Public frozen numeric
projections contain no events. This grants no additional publication authority.

A local command can report its actual start, completion and exit through
`scripts/porthole/event-run.mjs`. Supply the current native session privately in
`PORTHOLE_SESSION`, then invoke the script with origin, service, environment,
team, `--` and the command. The executed command does not receive that session.
The reporter sends its measured execution facts after completion, and prints
only the run ID, outcome, submitted facts and event IDs.

Installation archives preserve immutable event facts and private filter
configuration, with opaque actor references. Restore quarantines events and
filters; it transfers no session, grant, active filter, monitor or publication.
Erased actors cannot make their event content readable through search, detail or
overlays. These read fences do not claim complete subject erasure or retention
qualification under PORT-035 and PORT-096.

Kubernetes, AWS and integration connectors, authenticated provider provenance,
event export, the remaining facet and graph catalog, event-monitor evaluation
and unchanged Datadog callers remain unqualified. Authorized AWS source identity
is not supplied. The native slice does not establish PORT-069 DONE.
