# Claude Code guidance

@AGENTS.md

`AGENTS.md` is the canonical instruction file for this repository. Follow it in full,
especially the privacy boundary: private identity and deployment context belong only
under the Git-ignored `data/` directory, while live secrets belong only in `.env`.

Before editing Next.js code, read the relevant documentation shipped in
`node_modules/next/dist/docs/`. Before committing, review the staged snapshot rather
than relying only on the working-tree diff, then run the documented privacy scans,
`npm run lint`, and `npm run build` as applicable.
