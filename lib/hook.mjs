// The Claude Code hook that rescans after every turn. Shared by `tend hook` and `tend ui`.
// Run with npx, tend lives in a cache npm may clear, so the hook runs a copy kept in ~/.tend/app.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEND_DIR, readJson, writeJson } from './store.mjs';

export const SETTINGS = path.join(os.homedir(), '.claude', 'settings.json');
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const APP_DIR = path.join(TEND_DIR, 'app');
const APP_FILES = ['bin', 'lib', 'ui', 'badge', 'package.json'];
export const HOOK_CMD = `(node "${path.join(APP_DIR, 'bin', 'tend.mjs')}" scan --quiet >/dev/null 2>&1 &)`;
const EVENTS = ['Stop', 'SessionEnd'];

// Any tend scan hook counts as ours, including ones that point at an older copy.
const isTendHook = (cmd) => typeof cmd === 'string' && /[/\\]bin[/\\]tend\.mjs" scan --quiet/.test(cmd);
const version = (root) => readJson(path.join(root, 'package.json'), {}).version;

export function hookStatus() {
  const settings = readJson(SETTINGS, {});
  return Object.fromEntries(EVENTS.map((ev) => [ev, (settings.hooks?.[ev] ?? []).some((g) => g.hooks?.some((h) => isTendHook(h.command)))]));
}

export const hookInstalled = () => Object.values(hookStatus()).every(Boolean);

export function installApp() {
  if (path.resolve(PKG_ROOT) === path.resolve(APP_DIR)) return;
  fs.rmSync(APP_DIR, { recursive: true, force: true });
  fs.mkdirSync(APP_DIR, { recursive: true });
  for (const f of APP_FILES) {
    const from = path.join(PKG_ROOT, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(APP_DIR, f), { recursive: true });
  }
}

// Keeps the hook's copy current when a newer version is run, so `npx gettend-cli@latest` updates it too.
export function refreshApp() {
  const settings = readJson(SETTINGS, {});
  const usesApp = EVENTS.some((ev) => (settings.hooks?.[ev] ?? []).some((g) => g.hooks?.some((h) => h.command === HOOK_CMD)));
  if (usesApp && version(APP_DIR) !== version(PKG_ROOT)) installApp();
}

// What `setHook(true)` will add, shown to people before anything is written.
export function hookPreview() {
  return {
    settings: SETTINGS,
    backup: `${SETTINGS}.tend-backup`,
    appDir: APP_DIR,
    entries: Object.fromEntries(EVENTS.map((ev) => [ev, [{ hooks: [{ type: 'command', command: HOOK_CMD }] }]])),
  };
}

// Adds or removes only tend's own hook entries; everything else in settings.json is left as it was.
export function setHook(install) {
  const settings = readJson(SETTINGS, {});
  if (fs.existsSync(SETTINGS)) fs.copyFileSync(SETTINGS, `${SETTINGS}.tend-backup`);
  if (install) installApp();
  settings.hooks ??= {};
  for (const ev of EVENTS) {
    const groups = (settings.hooks[ev] ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isTendHook(h.command)) }))
      .filter((g) => g.hooks.length);
    if (install) groups.push({ hooks: [{ type: 'command', command: HOOK_CMD }] });
    if (groups.length) settings.hooks[ev] = groups; else delete settings.hooks[ev];
  }
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeJson(SETTINGS, settings);
  return { backup: `${SETTINGS}.tend-backup` };
}
