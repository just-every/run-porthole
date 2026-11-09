# sx-porthole-f466fix1 plan

1. Initialize fleet identity, launcher, bundle-backed Git helper, commit cleanup hooks, push guard and separate evidence transport. Clone only just-every/run-porthole with full history.
2. Start cloud/sx-porthole-f466fix1 at d77a80daa5c1b4a608839d079ccc20ca28ecc7c9. Merge main, preserving main CONTRACT.md, generated views and later handoff/fleet behavior. Resolve source conflicts by combining both behaviors, not deleting assertions; regenerate source lock last.
3. Compare PORT-060 with main, trace the 429 at the restart replay through credential verification and intake quota reservation. Fix only that defect, keeping PORT-060 PARTIAL and its claim scope unchanged.
4. Run syntax, focused quota behavior and typecheck locally. Do not attempt the netem estate locally, full local Verify, or publication scan. Push once the final candidate passes touched checks; hosted network Verify is the required estate proof. If a first save becomes necessary, use [skip ci].
5. Inspect all candidate identities/trailers including side parents before pushing through cloud-push.py. Discover and poll exact-SHA Verify using one REST watcher, at least 300 seconds between calls per run and within ten GitHub calls. Read each completed failed job once; rerun known traces ERR_ADDRESS_IN_USE jobs once if encountered.
6. Save complete non-secret plan, results, command receipts and exact CI provenance in this packet. Publish only these explicit regular files to evidence/sx-porthole-f466fix1. Return POST lines and exact terminal custody without landing or pushing main.
