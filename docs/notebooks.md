# Private investigation notebooks

Open **Notebooks** from Pipeline health. A current owner can start an
investigation from a recorded firing evaluation, then add ordered text, query
and chart cells. Queries require an explicit service, environment, team and
absolute time range in Unix nanoseconds. A capture includes at most 2,000
records; larger results are refused rather than presented as complete.

Each change creates a revision with its author and time. **Rerun against current
data** saves a new revision using the chosen bounds and the current intake
watermark. Earlier revisions retain their original bounds, cell order and
evidence references. Historical results are resolved from currently authorized
native telemetry reads. If referenced inputs disappear or are erased, the cell
shows unavailable evidence and no historical count or detached result copy.
Charts use actual retained observations without filling missing values.
When a supported SQL query selects a count, average or duration percentile,
the notebook computes that aggregate across every captured page and plots its
window result at the ending bound, with that meaning stated beside the chart.

Annotations can include a local teammate reference. The notebook explicitly
reports these mentions as **Undelivered**; no notification is sent and a mention
never grants access. Member names are resolved from the current directory;
erased identities are not restored from revision history.

Use **Sharing Settings** on a notebook to grant or revoke a private member or
team link. Recipients must sign in, remain current members and have telemetry
permission for every cell and the originating monitor scope. A link cannot
expand that permission. Adding a cell outside a recipient's scope makes the
whole notebook unavailable to that recipient. Changes to the granting owner's
authority invalidate its grants. Owner creation and mutation are the interim
conservative default; delegated editing is not qualified.

The product archive includes notebook cells, revision and annotation history.
It excludes sharing grants. Restored notebooks are private, inactive context:
they do not replay mentions, restore grants or expose copied query results.
Current owners can inspect that context, but cannot activate it through the
notebook mutation doors. Ordinary native telemetry reads remain separately
authorized. Broader sharing restoration and derived retention qualification
remain open; this feature adds no deletion, expiry or outbound authority.

Reviewed sanitized external publication, service-change links, broader alert
integration and imported source-notebook continuity are not implemented. The
ten authorized Datadog source notebooks and durable referenced trace evidence
are still required by PORT-039, PORT-048 and PORT-090. No source-retirement or
full notebook-continuity claim follows from the native notebook journey.

The versioned native API follows the same session and origin checks. Read
`/api/porthole/v1/notebooks/evaluations` as an owner to select an authorized
firing evaluation with its original bounds. Create a notebook by posting
`name` and `evaluationId` to `/api/porthole/v1/notebooks`. Read the returned
notebook reference at `/api/porthole/v1/notebooks/<id>`; `?version=<revision>`
selects retained context. Every mutation includes the current `revision`.
The `cells`, `reorder`, `rerun` and `comment` actions save new revisions;
`share` and `unshare` manage private grants. Bearer telemetry credentials
are refused on all notebook doors.
