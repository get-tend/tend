// "Keep Tend available": a macOS login item that keeps the Tend page running at a fixed
// address, so a bookmark always works. Off unless the person turns it on.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { TEND_DIR } from './store.mjs';
import { APP_DIR, installApp } from './hook.mjs';

export const SERVICE_PORT = 4317;
const LABEL = 'eco.gettend.ui';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const domain = () => `gui/${process.getuid()}`;

export const serviceSupported = () => process.platform === 'darwin';
export const serviceOn = () => serviceSupported() && fs.existsSync(PLIST);

function plist() {
  const args = [process.execPath, path.join(APP_DIR, 'bin', 'tend.mjs'), 'ui', '--no-open', '--port', String(SERVICE_PORT)];
  const x = (v) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args.map((a) => `    <string>${x(a)}</string>`).join('\n')}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${x(path.join(TEND_DIR, 'ui.log'))}</string>
  <key>StandardErrorPath</key><string>${x(path.join(TEND_DIR, 'ui.log'))}</string>
</dict>
</plist>
`;
}

export function setService(on) {
  if (!serviceSupported()) throw new Error('Keeping Tend available in the background works on macOS only for now.');
  try { execFileSync('launchctl', ['bootout', `${domain()}/${LABEL}`], { stdio: 'ignore' }); } catch { /* not loaded */ }
  if (!on) {
    fs.rmSync(PLIST, { force: true });
    return { on: false };
  }
  installApp();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(PLIST, plist());
  execFileSync('launchctl', ['bootstrap', domain(), PLIST]);
  return { on: true, url: `http://127.0.0.1:${SERVICE_PORT}`, plist: PLIST };
}

export const servicePlistForTest = plist;
