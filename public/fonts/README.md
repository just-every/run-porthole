# Fonts

Porthole's four faces are self-hosted from `porthole/` under their own licences
(`LICENSE-Inter.txt`, `LICENSE-JetBrainsMono.txt`, `LICENSE-DepartureMono.txt`,
`LICENSE-Caveat.txt`): Inter (variable, with its optical-size axis) for headings
and text, JetBrains Mono for queries, logs, config and paths, Departure Mono for
the team tags, and Caveat for the homepage's hand notes.

`/rer-theme.css` declares the four `@font-face` rules once, for the app, Base's
documents, the homepage and the docs; `docs/LOOK.md` names the stacks that use
them (`--sans`, `--mono`, `--pixel`, `--hand`). App documents and Base's frames
preload only the Inter file (`src/base/font-head.ts`); the homepage and the docs
preload it in their own heads. No page makes a third-party font request.
