# Private dashboard layouts and powerpacks

Dashboards can arrange existing metric, log and trace widgets inside private
layout groups. Open **Layout and powerpacks** on a dashboard to group its panels
or bind an existing powerpack. **Layout settings** on each item provides width,
height, keyboard move controls and a saved collapse state. Narrow screens stack
items in their saved order. Use **Edit dashboard** for nested membership and
child variable or service bindings. Saving creates an audited immutable revision.

A dashboard body may include `layout`. Every panel must appear exactly once.
A panel cell has `panel`, `width` (one to twelve columns) and `height` (one to four
rows). A group has `id`, `title`, `width`, `height`, `collapsed` and `children`.
Groups may set `service` and `variables` with `team` and `environment`; nested
groups inherit those values. Explicit dashboard URL variables override the
corresponding group defaults. Every effective child scope is checked against the
dashboard definition and current reader authority. Each underlying query link
carries that child's actual service, variables and original time range.

```json
{
  "id": "service-group",
  "title": "Service traffic",
  "width": 12,
  "height": 1,
  "collapsed": false,
  "variables": {"team": "commerce", "environment": "production"},
  "children": [{"panel": "request-count", "width": 6, "height": 1}]
}
```

Powerpacks live in **Settings → Dashboard powerpacks**, at
`/app/settings/dashboard-powerpacks`. A current native owner with fresh sign-in
proof previews the exact definition, source revision and every affected
consumer revision, then approves that packet within five minutes. A changed
consumer, pack, owner authority or digest requires a new review. Bearer
credentials cannot preview or approve, even with an owner cookie. Pack reads
also require a current native owner. This interim owner-only administration does
not qualify future delegated pack administration or source-provider parity.

The native API uses `/api/porthole/v1/dashboard-powerpacks` for listing,
`/api/porthole/v1/dashboard-powerpacks/<id>` for current and historical
definitions, and the `preview` and `approve` action paths beneath that root.
A preview accepts `name`, `scope`, a dashboard-shaped `body` with native `layout`,
and the existing `id` and `revision` for an update. Approval accepts the returned
review `id` and `digest`, with `confirm` equal to `apply-private-powerpack`.
A preview does not change a pack or any dashboard. Approval is one transaction
that records a new pack revision and advances all bound consumer revisions.

Bind from the dashboard form using the pack ID and current revision. The server
copies the reviewed native widgets into a group with a `powerpack` reference
containing `id` and `revision`, and prefixes child IDs with the group ID. Bindings
retain their group title, position, size, collapse state and variable overrides.
The referenced pack version supplies its child layout and widgets. Editing
those children in a consumer definition is refused explicitly without saving a
revision; change the reusable definition in Settings and review all consumers.
Consumer group bindings remain editable in the dashboard JSON form. The consumer
keeps its dashboard time range and variable defaults unless a group supplies an
explicit child override. A pack cannot
contain another pack. The native bounds are thirty panels, four nested group
levels and fifty consumer dashboards per reviewed update; exceeding a bound
refuses explicitly. No unsupported source-import flag is treated as qualified.

Private layouts cannot create new public snapshots. Existing public TV, embed
and widget-image addresses remain subject to their original source revision,
owner authority, expiry and revocation. Adding a layout or applying a pack update
advances that source revision without renewing publication. Restoring owner
access, replaying traffic or restarting the installation never renews an old
address.

Installation archives preserve layout bodies and pack revision history. Restored
dashboards and packs are private and inactive. Review approvals are excluded,
no session or delegated access is restored, and re-export preserves the inactive
state. Widgets resolve through current authorized telemetry reads; a missing or
erased record is never copied out of pack definitions or resurrected from them.
Unavailable analytical storage remains an explicit error with no local fallback.

This is a native private structural slice of PORT-068. It does not qualify the
complete widget or function catalog, Datadog import parity, external assets,
public layout publication or the required twenty authorized source dashboards.
The complete remaining scope stays in the contract Gap.
