# GenAI metadata and tool correlation

Porthole's native GenAI view is `/app/genai`. Its read-only JSON door is
`GET /api/porthole/v1/genai`. Both use current trace permissions and the selected
analytical worker. Finance membership alone grants no telemetry access.

The view groups observed model calls by provider, returned model and feature.
It shows request and response models, declared conventions, streaming and
application attempt metadata, original latency, failures, tool call identifiers
and parent spans. Trace links open the existing trace waterfall. Identical span
copies are counted once; conflicting identities contribute no usage counters.

Use `trace`, `service`, `environment`, `team`, `from` and `through` to select
retained evidence. Times use Unix nanoseconds. The response includes a snapshot
and cursor. An unfiltered request examines at most 200 trace records; a selected
trace examines at most 2,000. Follow the cursor with the same snapshot and
filters. Groups describe the selected page, and a remaining cursor explicitly
marks partial coverage. They are not installation-wide billing totals.

## Register the stock instrumentation

Load `./instrumentation/genai/register.cjs` before importing either provider SDK.
The registration uses the exact dependency pins in `package.json`:

- The stock OpenTelemetry OpenAI plugin uses GenAI conventions 1.36.0 for Chat
  Completions. The current wrapper qualifies that API only.
- The stock Traceloop Anthropic plugin uses GenAI conventions 1.40.0 for Messages.
- The local feature and tool spans carry the wrapper's declared convention.

Configure standard OTLP trace export to the installation's `/v1/traces` with a
scoped Porthole ingest credential. Keep credentials in the process environment.
Set the service, deployment environment and team resource attributes to values
the credential permits. No provider account or paid call is created by loading
the module.

```js
const {sdk, feature, modelCall, tool} = require('./instrumentation/genai/register.cjs')

await feature('checkout-assistant', async () => {
  const observed = await modelCall({streaming: false, attempt: 1}, async () => {
    return client.chat.completions.create(request)
  })
  const selected = observed.result.choices[0].message.tool_calls[0]
  await tool({
    name: selected.function.name,
    callId: selected.id,
    parent: observed.spanContext,
  }, () => executeApprovedLocalTool(selected))
})
await sdk.shutdown()
```

For streaming, consume the actual SDK iterator inside `modelCall`. An
application retry uses its actual attempt number and a separate `modelCall`.
Internal SDK transport retries are not inferred from elapsed time. A tool's
parent must be the returned context of the model call that requested it. Tool
execution is application code; Porthole neither schedules nor authorizes it.

## Usage is observed evidence

Missing counters are `null`, including failed calls with no reported usage.
Partial observed counters remain separately visible. Cache reads and cache
creation remain distinct. The pinned OpenAI Chat Completions instrumentation
does not emit cached-token counters: those remain unavailable even when a
provider response contains them. Porthole does not infer them from other fields.
The Anthropic plugin emits its observed cache counters.

USD, effective rate source and provider reconciliation remain unavailable. No
rate, provider report import, report grant or live provider receipt is present.
An unavailable report cannot be described as a delayed report without actual
evidence. The local schema-edge journey proves neither provider authority nor
source-report parity, billing accuracy or complete adapter lifecycle behavior.

## Content stays disabled

Prompt, completion, system-instruction and tool-argument capture has no enabled
consent door. The registration disables provider content capture, including an
inherited OpenAI capture override, and does not export provider logs. It removes
provider exception messages and stacks before exporting spans because errors
can echo request or response contents. Failure type and status remain.

Intake rejects content-bearing GenAI attributes, message bodies and unsafe
span events or status descriptions before creating a durable envelope. The
refusal is `genai_content_not_authorized`, without a key, value or payload in its
diagnostic. Gzip and protobuf intake follow the same admission guard. Ordinary
retained telemetry, pending envelopes, analytical copies and installation
archives therefore contain only admitted metadata from this registration.
Existing owner-directed erasure and replay fences still apply. Independent
archive restore keeps collection paused and transfers no source credential,
provider secret, source session or consent authority.

Scoped opt-in content consent, redaction, retention and complete provider
qualification remain open. Do not enable content capture or use this view as a
security evaluator or agent builder.
