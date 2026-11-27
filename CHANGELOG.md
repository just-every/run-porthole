# Changes

## 0.1.0 (27 Nov 2026)

First published release.

- Mail off by default for a hosted installation: `MAIL_PROVIDER=none` needs no sender or mail key, every send is refused with `mail_off` without contacting a provider, and the owner signs in with `rer signin`.
- RER 0.2.143. The demo workflow deploys each published release at its tag.
- RELEASE.json lists all 70 migrations (67 core, 3 analytics Worker).
