# Changelog

## 1.0.2

- First release published from GitHub, with a provenance badge linking it to its commit. No changes to how Tend works.

## 1.0.1

- The page responds right away when you pick a restore amount, and saves the choice in the background.
- The page reuses its last scan until a Claude Code log changes, so it reloads in a moment instead of several seconds.
- Each restore amount now shows exactly what to buy, both carbon removal and water restoration, and fills in the form. The split slider is gone.
- Placeholder "<synthetic>" entries Claude Code writes for interrupted or failed requests no longer show as a model.

## 1.0.0

First release.

- Footprint for every Claude Code project: energy, CO2e and water as low, middle and high estimates.
- `gettend` opens a local page to track projects, see what to buy, and record purchases.
- Optional hook updates footprints after every Claude Code turn. It shows the exact settings change and asks before adding it.
- Badge for your site, read from each project's `footprint.json`.
- Badges: pill, label and stub. Each says "restored" only with checked proof, shows the covered date on hover, matches the light or dark page it sits on, and keeps its check for 30 days after the latest purchase before showing the share restored.
- Method versions: each purchase stores the method it used, and a method update gives 30 days to fund any difference.
- No dependencies. Makes no network requests, checked by `npm test`.
