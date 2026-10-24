# Porthole

Know whether production is healthy, why it is not, and what changed.

100% free, open source alternative to Datadog, New Relic, Grafana Cloud, Dynatrace.

Porthole is a new seed on the Base technical foundation. The observability product is the target in [CONTRACT.md](CONTRACT.md) and [ACCEPTANCE.md](ACCEPTANCE.md); all product clauses are missing. This starting tree provides the shared Lobby, owner sign-in, setup, D1 and local development mail suppression. Product design and build rounds follow later.

## Run locally

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-porthole
```

Git is required; rer brings Node and pnpm. Already have Node 22 or later? `npx -y @runeditrun/rer dev just-every/run-porthole` does the same. If the installer prints a line that puts `rer` on your PATH, run that line too. To start it again later, run the same line from the same folder, or `cd run-porthole && rer dev`.

Read [RUN-LOCALLY.md](RUN-LOCALLY.md) and [OPERATIONS.md](OPERATIONS.md) for commands and state. Node 22.20.0, pnpm 10.12.4 and the published `@runeditrun/rer` 0.2.76 are pinned. [edition.json](edition.json) records Base source provenance; the MIT licence is in [LICENSE](LICENSE).

The public Run page is https://run-porthole.com/run. The public run site at run-porthole.com is built with `rer build --site`, including `/run`, `/docs` from the repository's Markdown and `/contract` from root CONTRACT.md. The separate Run site workflow deploys only when `RUN_SITE_DEPLOY=true`; it needs `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. Verify runs independently.

## Try the demo

[Open Porthole Demo](https://demo.run-porthole.com/) for a private, temporary copy, or run `rer demo` locally. The demo opens signed in to the current foundation Lobby with setup complete. Porthole’s observability features are still to be built; the demo contains no telemetry. Invitations succeed with mail silently suppressed. Demo data is isolated from other visitors and from local owner data.
