# Security

Tend reads your Claude Code logs and, if you turn on automatic updates, edits your Claude Code settings. If you find a way it could leak data, reach the internet, or change something it shouldn't, please tell me privately first.

**Report a problem:** use "Report a vulnerability" under this repository's Security tab, or email nisa.andrews@gmail.com with "Tend security" in the subject. I'll reply within 3 days.

## What Tend promises

- It sends nothing anywhere. The page runs at 127.0.0.1 and refuses requests from other websites.
- It reads only token counts, model names, session IDs and timestamps from `~/.claude/projects`.
- It never writes your prompts, responses, code or file names into anything.
- It changes `~/.claude/settings.json` only after showing you the change and asking, and it backs the file up first.

`npm test` checks each of these. The tests run every command and the page with outside network requests blocked and recorded.

## Checking a release yourself

- Every version on npm is built and published by GitHub Actions from a tagged commit. The npm page shows a provenance badge linking to that commit and run.
- `npm pack gettend` downloads the exact files without running them. Tend has no dependencies, so those files are everything that runs.

## Supported versions

Only the latest version gets fixes.
