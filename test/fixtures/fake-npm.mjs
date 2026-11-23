import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const failures = {
  network: 'npm error code ENOTFOUND\nnpm error syscall getaddrinfo\nnpm error errno ENOTFOUND\nnpm error network request to https://registry.npmjs.org/@agentclientprotocol%2fclaude-agent-acp failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org\nnpm error network This is a problem related to network connectivity.\n',
  certificate: 'npm error code SELF_SIGNED_CERT_IN_CHAIN\nnpm error errno SELF_SIGNED_CERT_IN_CHAIN\nnpm error request to https://registry.npmjs.org/@agentclientprotocol%2fclaude-agent-acp failed, reason: self-signed certificate in certificate chain\n',
  mirror: 'npm error code ETIMEDOUT\nnpm error network request to https://npm.example.internal/@agentclientprotocol%2fclaude-agent-acp failed, reason: connect ETIMEDOUT 10.0.0.9:443\n',
  missing: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@agentclientprotocol%2fclaude-agent-acp - Not found\n',
};
if (process.env.FAKE_NPM_FAIL) {
  process.stderr.write(failures[process.env.FAKE_NPM_FAIL] ?? failures.network);
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
