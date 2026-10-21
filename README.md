# Porthole

Know whether production is healthy, why it is not, and what changed.

100% free, open source alternative to Datadog, New Relic, Grafana Cloud, Dynatrace.

Porthole is a new seed on the Base technical foundation. The observability product is the target in [CONTRACT.md](CONTRACT.md) and [ACCEPTANCE.md](ACCEPTANCE.md); all product clauses are missing. This starting tree provides the shared Lobby, owner sign-in, setup, D1 and local development mail suppression. Product design and build rounds follow later.

## Run locally

```sh
curl -fsSL https://runeditrun.com/install.sh | sh
rer dev just-every/run-porthole
```

Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-porthole` does both steps. To start again: `cd run-porthole && rer dev`.

Read [RUN-LOCALLY.md](RUN-LOCALLY.md) and [OPERATIONS.md](OPERATIONS.md) for commands and state. Node 22.20.0, pnpm 10.12.4 and the published `@runeditrun/rer` 0.2.73 are pinned. [edition.json](edition.json) records Base source provenance; the MIT licence is in [LICENSE](LICENSE).

The public run site at run-porthole.com is built with `rer build --site`, including `/run`, `/docs` from the repository's Markdown and `/contract` from root CONTRACT.md. The separate Run site workflow deploys only when `RUN_SITE_DEPLOY=true`; it needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Verify runs independently.
