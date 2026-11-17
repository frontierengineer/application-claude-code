import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write('npm error code ENETUNREACH\nnpm error network request to https://registry.npmjs.org failed\n');
  process.exit(1);
}
const prefix = args[args.indexOf('--prefix') + 1];
const specification = args[args.length - 1];
const at = specification.lastIndexOf('@');
const name = specification.slice(0, at);
const version = specification.slice(at + 1);
if (process.env.FAKE_NPM_LOG) writeFileSync(process.env.FAKE_NPM_LOG, JSON.stringify(args));
const adapter = join(prefix, 'node_modules', ...name.split('/'));
mkdirSync(join(adapter, 'dist'), { recursive: true });
writeFileSync(join(adapter, 'package.json'), JSON.stringify({ name, version, type: 'module', bin: { 'claude-agent-acp': 'dist/index.js' } }));
copyFileSync(join(here, 'fake-adapter.mjs'), join(adapter, 'dist', 'index.js'));
const sdk = join(prefix, 'node_modules', '@anthropic-ai', 'claude-agent-sdk');
mkdirSync(sdk, { recursive: true });
writeFileSync(join(sdk, 'package.json'), JSON.stringify({ name: '@anthropic-ai/claude-agent-sdk', version: '0.3.326', type: 'module', exports: { '.': { default: './sdk.mjs' } } }));
copyFileSync(join(here, 'fake-sdk.mjs'), join(sdk, 'sdk.mjs'));
const platform = join(prefix, 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64');
mkdirSync(platform, { recursive: true });
writeFileSync(join(platform, 'claude'), '#!/bin/sh\necho claude\n');
chmodSync(join(platform, 'claude'), 0o755);
