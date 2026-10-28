import { escape as e, operationDocument } from '../document'

type State = {
 revision: number
 definition: unknown | null
 history: { revision: number; definition: unknown; created_at: number }[]
 preview?: { id: string; digest: string; definition: unknown; results: unknown[]; expectedRevision: number }
 error?: string
}

const initial = { service: 'checkout', environment: 'production', team: 'payments', processors: [{ type: 'json' }], metrics: [{ name: 'checkout.logs' }] }
const samples = JSON.stringify([
 JSON.stringify({ message: 'Checkout completed', status: 'info', order_id: 'order-1042', amount: 49.95 }),
 '{\n  "message": "Payment authorization failed",\n  "status": "error",\n  "order_id": "order-1043"\n}',
 '{"message":"Checkout response interrupted", malformed}'
], null, 2)
const json = (value: unknown) => e(JSON.stringify(value, null, 2) ?? 'null')
const hidden = (name: string, value: string | number) => `<input type="hidden" name="${name}" value="${e(value)}">`
const sampleField = () => `<label>Sample log bodies (JSON array of strings)<textarea name="samples" rows="12" required spellcheck="false">${e(samples)}</textarea></label>`
const date = (value: number) => Number.isFinite(new Date(value).getTime()) ? new Date(value).toISOString() + ' (UTC)' : 'Date unavailable'
const resultObject = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

// The route supplies sanitized definitions and results. This page has no client
// storage or script state; activation submits only the exact preview identity.
export function page(state: State, status = 200): Promise<Response> {
 const preview = state.preview
 const results = preview?.results.map(resultObject) ?? []
 const excluded = results.filter(row => row.excluded === true).length
 const errors = results.reduce((total, row) => total + (Array.isArray(row.errors) ? row.errors.length : 0), 0)
 return operationDocument('Log pipelines', `
 <nav aria-label="Settings"><a href="/app/settings/members">Members</a> · <a href="/app/settings/credentials">Credentials</a> · <a href="/app/settings/pipelines" aria-current="page">Log pipelines</a></nav>
 ${state.error ? `<p role="alert">${e(state.error)}</p>` : ''}
 <p role="status">${state.definition === null ? 'No active pipeline.' : 'Active pipeline available.'} Current revision: ${e(state.revision)}.</p>
 <p><a href="/api/porthole/v1/pipelines/catalog">Processor catalog</a></p>
 <p>Preview sample transformations before activating a pipeline. Activation applies the exact reviewed definition to future logs.</p>
 ${state.definition === null ? '' : `<details><summary>Active definition</summary><pre>${json(state.definition)}</pre></details>`}
 ${preview ? `<section aria-labelledby="pipeline-preview"><h2 id="pipeline-preview">Review preview</h2>
 <p>Based on revision ${e(preview.expectedRevision)}.</p>
 <dl><dt>Sample logs</dt><dd>${results.length}</dd><dt>Retained</dt><dd>${results.length - excluded}</dd><dt>Excluded</dt><dd>${excluded}</dd><dt>Parser errors</dt><dd>${errors}</dd></dl>
 <details><summary>Reviewed definition</summary><pre>${json(preview.definition)}</pre></details>
 <h3>Sample transformations</h3>
 ${preview.results.length ? `<ol>${preview.results.map(result => `<li><pre>${json(result)}</pre></li>`).join('')}</ol>` : '<p>No sample results returned.</p>'}
 ${preview.expectedRevision === state.revision ? `<form method="post" action="/app/settings/pipelines/activate">${hidden('previewId', preview.id)}${hidden('digest', preview.digest)}
 <label><input type="checkbox" name="confirm" value="activate-pipeline" required>I approve this exact pipeline, including any exclusion rules shown above.</label>
 <button type="submit">Activate reviewed pipeline</button></form>` : '<p role="alert">The active revision changed. Preview again before activating.</p>'}
 </section>` : ''}
 <section aria-labelledby="pipeline-edit"><h2 id="pipeline-edit">${preview ? 'Revise and preview again' : 'Configure pipeline'}</h2>
 <form method="post" action="/app/settings/pipelines/preview">${hidden('revision', state.revision)}
 <label>Pipeline definition (JSON)<textarea name="definition" rows="16" required spellcheck="false">${json(preview?.definition ?? state.definition ?? initial)}</textarea></label>
 ${sampleField()}<button type="submit">Preview pipeline</button></form></section>
 <section aria-labelledby="pipeline-history"><h2 id="pipeline-history">Version history</h2>
 ${state.history.length ? `<ul>${state.history.map(row => `<li><p>Revision ${e(row.revision)} · ${e(date(row.created_at))}${row.revision === state.revision ? ' · Current' : ''}</p>
 <details><summary>Review revision ${e(row.revision)}</summary><pre>${json(row.definition)}</pre>
 <form method="post" action="/app/settings/pipelines/preview">${hidden('revision', state.revision)}${hidden('definition', JSON.stringify(row.definition) ?? 'null')}
 ${sampleField()}<button type="submit">Preview rollback to revision ${e(row.revision)}</button></form></details></li>`).join('')}</ul>` : '<p>No pipeline versions recorded.</p>'}
 </section>`, status, { forms: true })
}
