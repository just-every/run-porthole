# PORT-099 — Frozen future acceptance rubric

Date: 4 November 2026. Authority: ct's PORT-014 two-FIX DEFER and additive split ruling RL-101.

PORT-099 is Core, from new, and missing with empty Evidence. These are future requirements for Porthole's next planned round, not executed evidence or permission for a third PORT-014 FIX. All PORT-014 obligations and its existing judgment remain unchanged.

| Item | Required future public-door proof |
| --- | --- |
| R1 | Use nonempty real public metric intake and query end to end. Declare the range step and lookback explicitly: evaluate at T and T+20 seconds with a lookback shorter than 20 seconds, so the grouped producer contributing 400 milliseconds at T does not overlap the producer contributing 3 seconds at T+20 seconds. Check returned values, declared unit, labels, timestamps and completion. Accept exact conversion to one declared unit (for example [400, 3000] milliseconds or [0.4, 3] seconds), distinct correctly labeled series, or explicit refusal; never accept complete [400, 3] milliseconds. |
| R2 | A nonempty same-unit allowed grouped range completes with the correct values, labels and timestamps. |
| R3 | Attempt simultaneous incompatible-unit inputs and an unsupported unit combination. Require refusal or correct conversion for incompatible inputs, no misleading complete result for unsupported combinations, and refused no-effect read-back of the saved result and source metrics. |
| R4 | Repeat equivalent supported queries through local and analytical evaluation doors; returned values, units, labels, timestamps and result/refusal completion obey the same promised semantics. |
| R5 | Inspect ordinary Explore result and refusal screens once at 1440 and 390. Returned status and units are accurately reflected and no refusal or incompatible range appears falsely complete. |

The source probe motivating this requirement is ordinary scalar grouped range evaluation with contributing producer turnover between steps. sx-porthole-c-f252 head `4a44856ebf267ee2e8a3a80f6299c0cf5a84f479` attached the first unit to later differently scaled values; sx-porthole-c-f246 and sx-porthole-c-f252 do not land as gated. Stock Prometheus comparison is unitless and cannot justify Porthole attaching an incorrect unit.

Retain PORT-014's complete compliance, function, native-histogram, exemplar, recording-rule, retention/capacity, history and privacy scope. No field-proof exclusion is added: this capability can be proved by the seed. The contract adds no evidence or DONE claim. Independent Opus review holds this additive candidate before any lane landing submission.
