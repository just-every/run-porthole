# Prior Verify diagnosis

Prior candidate: 843cefdeab89ace4ed4543f1ffdb55d0e22b3495.
Prior run: 42532000070, attempt 1.

The GitHub jobs API reports analytical job 128888052134 and typecheck job 128888052194 as cancelled, not assertion failures. Both started at 22:47:55 UTC and completed at 23:00:10 UTC on 8 November. Their shard execution steps were cancelled together at 23:00:08, after 696 and 694 seconds respectively. The workflow limits jobs to twelve minutes. The aggregate verify job 128891075287 then failed because not all shards succeeded. No setup, dependency, browser-install or source-lock step failed.

The prescribed failed-log archive invocation was attempted once for each reported job and returned an empty log with exit zero. A full-log invocation for each also returned no bytes. There is no quoted failing assertion to repair from these archives. No direct job-log download or signed URL retry was attempted.

Local shard reproduction uses CI=true, WRANGLER_SEND_METRICS=false and PLAYWRIGHT_SKIP_BROWSER_GC=1. Chromium is the managed /usr/bin/chromium binary. The first overlapping typecheck attempt refused its build because the analytical build owned the local operation lock; this is a local orchestration error, not a reproduced CI assertion. Its serialized rerun will be recorded separately.

The API timing receipt also records successful execution-step durations: source 264 seconds, mail receipts 297, traces 338, follow-up 382, runtime 386, ingest 411, dashboards 527, migration 602 and exports 229. This supports investigating command distribution inside the existing verification plan without increasing the workflow timeout or changing assertions.

Initial diagnosis used six GitHub CLI invocations. Candidate discovery and final polling brought the final total to nine; see api-budget.json. Verify 42562847296 completed successfully on the exact final candidate.

Both original shards completed successfully on the saved head in this VM. The serialized typecheck shard took 547 seconds, including real native and analytical Services and fleet restoration. The proposed fix redistributes three unchanged commands: native backup to traces, heartbeat to mail receipts, and database qualification to exports. This retains all eleven pre-existing shards and their capabilities, and does not edit the workflow or extend its timeout. Command start timestamps and elapsed durations are now logged for future cancellation diagnosis. No product assertion repair was indicated.
