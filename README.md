# Tend

See the energy, carbon and water behind your Claude Code tokens, then settle it with carbon removal and watershed restoration. Show what you restored with a badge on your site.

```bash
npx gettend-cli
```

That opens the Tend page in your browser. From there:

1. **Pick a project to track.** Tend writes a small `footprint.json` into it for your site's badge.
2. **Turn on automatic updates.** Your footprint updates after every Claude Code turn.
3. **Settle.** Tend shows how much carbon removal and water restoration to buy. Buy it, then record it on the page. Your badge then shows what you removed and restored, with links to your certificates.

Requires [Node.js](https://nodejs.org) 18 or newer, and Claude Code.

## Why you can trust it

- **No dependencies, about 65 kB.** The whole tool is 11 files you can read in a few minutes.
- **Sends nothing anywhere on its own.** `npm test` runs every command and the page with network access blocked, and fails if Tend tries to reach the internet. The one exception is a button you click: "Add to the shared total" on a purchase with proof sends that purchase's amounts and proof link to gettend.eco, and nothing else.
- **Asks before changing anything.** Turning on automatic updates shows the exact change to your Claude Code settings first.
- **Published from GitHub.** Each npm version carries a provenance badge linking it to the commit that built it.
- **Try it read-only first.** `npx gettend-cli status` only reads your logs and prints a table.

Found a problem? See [SECURITY.md](SECURITY.md).

## What Tend reads and changes

- **Reads** the session logs Claude Code already keeps in `~/.claude/projects`. It uses only token counts, model names, session IDs and timestamps. Your prompts, code and file names never go into anything Tend writes.
- **Writes** its own files in `~/.tend` (which projects you track, your purchases) and a `footprint.json` in each project you track.
- **Changes** your Claude Code settings only when you turn on automatic updates. It adds one `Stop` and one `SessionEnd` hook to `~/.claude/settings.json`, saves a backup first (`settings.json.tend-backup`), and keeps a copy of itself in `~/.tend/app` for the hook to run.
- **Sends nothing anywhere.** The page runs only on your computer (127.0.0.1) and refuses requests from other websites.

## Keep Tend available (macOS)

```bash
npx gettend-cli service on    # Tend runs quietly in the background, so you can bookmark http://127.0.0.1:4317
npx gettend-cli service off
```

This adds a login item (`~/Library/LaunchAgents/eco.gettend.ui.plist`) that runs Tend's copy in `~/.tend/app`. The page offers the same switch.

## Proof

A recorded purchase counts toward "restored" on your badge only when it has a certificate or receipt link from a provider Tend recognizes (Remove Carbon Today, Carbonmark, Climeworks, Bonneville Environmental Foundation, ClimeCo, The Freshwater Trust and a few registries). Tend checks where the link points; it can't yet confirm the purchase itself. Purchases without proof stay in your record, marked "Needs proof", and you can add a link later on the page.

## Commands

The page does all of this too. After installing (`npm i -g gettend-cli`), `tend` works as a shorter name.

```bash
npx gettend-cli status                 # every project's tokens, energy, CO2e and water
npx gettend-cli link ~/my-site --multiplier 3
npx gettend-cli settle ~/my-site       # what to buy
npx gettend-cli settle record ~/my-site --co2 177 --carbon biochar --carbon-cert https://… \
  --water-gal 1000 --basin "Colorado River basin" --water-cert https://… --usd 28.55
npx gettend-cli settle list ~/my-site
npx gettend-cli settle undo ~/my-site
npx gettend-cli hook install           # or: hook uninstall, hook status
npx gettend-cli --help
```

- Sessions in a subfolder or a worktree count toward the git repo they belong to.
- Each purchase covers the usage since the one before it.
- The badge's multiplier rounds down, and the smaller of the carbon and water ratios wins, so it never claims more than you bought. Water Restoration Certificates come in 1,000-gallon units, so water usually ends up well above the multiplier, and carbon sets the number.

## Status line

```bash
npx gettend-cli statusline install
```

Shows this project's footprint at the bottom of Claude Code: `☘ checkout · 5.6 kg this week · ✓ restored`. It reads the summary Tend's scans keep, so install the hook too. If you already have a status line, it keeps running and Tend's part shows after it. `statusline uninstall` puts things back.

## Badge

For a README, use the `footprint.svg` Tend writes next to `footprint.json`:

```markdown
[![Tend footprint](public/footprint.svg)](https://gettend.eco)
```

For a website, copy `badge/tend-badge.js` from this package into your site (or load it from `https://unpkg.com/gettend-cli@1/badge/tend-badge.js`, which picks up fixes and design updates within version 1 automatically), then pick a style with `variant`:

```html
<script type="module" src="/tend-badge.js"></script>
<tend-badge src="/footprint.json"></tend-badge>                  <!-- pill (default): tokens and CO2e on one line -->
<tend-badge src="/footprint.json" variant="label"></tend-badge>  <!-- Footprint facts: energy, carbon, water, range, method version -->
<tend-badge src="/footprint.json" variant="stub"></tend-badge>   <!-- project credit: tokens, month, model mix, carbon, water, range -->
<tend-badge src="/footprint.json" theme="dark"></tend-badge>     <!-- theme: auto (default) matches the background behind the badge; light or dark forces one -->
```

Once purchases with proof cover the middle estimate, the pill adds "✓ restored", the label adds CO₂ removed and water restored rows, and the stub adds a "Funded" line. Hovering any style shows the date the purchases cover, and a restored pill links to the proof.

Usage keeps growing after a purchase, so the check stays for 30 days after the latest one. After that, if new usage is unfunded, the badge shows the share restored instead (for example "74% restored"). A method update gives the same 30 days to fund any difference. The badge works this out itself from the footprint file, so rule changes reach every site with the next script release.

`tools/badge-test.html` shows every style and state on a light and a dark page; check it before publishing.

## Footprint file (`tend/1`)

`tokens` (input, cacheWrite, cacheRead, output, total), `footprint` (kwh, co2Kg, waterL as low/mid/high, plus restoreUsd at 1×), `multiplier`, `restoreUsdAtMultiplier`, `weekly` (last 12 ISO weeks), `models`, `sessions`, `firstActive`, `lastActive`, `method`, and `restored` once a purchase has proof (multiplier, co2Kg, waterL, usd, carbon, watershed, settledThrough, lastFunded, graceUntil, status, coveredPercent, methodChange, receiptUrl, certificates). Each recorded purchase stores the method version it used.

## Method

These are estimates. AI providers don't publish energy or water per token, so Tend uses public figures and reports a low, middle and high value. Factors are in `lib/footprint.mjs`. Cached context reads make up most of an agent's tokens, so the cached-read factor (0.05 Wh per 1k tokens, range 0.02–0.12) matters most and is the least certain.

Tend doesn't make anyone carbon neutral. It helps you see your share and take responsibility for it.

## Uninstall

```bash
npx gettend-cli hook uninstall
rm -rf ~/.tend
```
