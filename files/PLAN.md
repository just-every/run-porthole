# Plan: PORT-054 blocking credential refusal only

1. Configure fleet identity, launcher authentication, commit hooks, cloud toolchain and report-only evidence transport.
2. Start from e2cfaedd2f158ea90c0f0176b9ea43fcee0fdffa; merge current origin/main. Retain main's contract and generated views whole, preserve main tests, combine independent route/schema/archive additions and renumber candidate migrations above main's 0063. Regenerate API schema and source lock. Publish the merge save without CI.
3. Extend the existing handoff journey with one aggregated credential-refusal regression assertion. Capture pre-fix HTTP write/read observations for sig, %73ig and SIG; include destination/template, userinfo and the existing credential parameter family.
4. Refuse credential-bearing URL values with handoff_credentials_forbidden and filter legacy unsafe destinations/templates from owner and restricted-reader surfaces. Keep all existing tests and the prior partial PORT-054 claim.
5. Commit only requested product changes and the generated source lock. Run touched public-door journeys, typecheck, schema and source freshness checks. Do not run a full local verification, publication scan or Docker.
6. Inspect all candidate identities/messages, push only cloud/sx-porthole-f461fix1 through the guard, inspect exact-SHA Verify through bounded REST requests, and publish this packet only under evidence/sx-porthole-f461fix1. Report actual outcome and POST lines without changing contract judgments or main.

7. Address the observed merge interaction without changing main's trace assertions: keep the shared fixture trace-only by default and explicitly enable logs for the existing handoff proof. Remove redundant regression setup subprocesses while retaining every per-case check; re-run touched proof on a new substantive commit and require its own exact-SHA Verify.
