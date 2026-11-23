import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Command, type Machine, homeOf, run } from './machine.ts';

export type SignIn = { state: 'signed_in'; how: string } | { state: 'signed_out' } | { state: 'expired' } | { state: 'keychain_locked' };

const keyVariables = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN'];
const cloudVariables = ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'];

async function json(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function expiry(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function configDirectory(machine: Machine): string {
  return machine.env.CLAUDE_CONFIG_DIR || join(homeOf(machine), '.claude');
}

const macSecurity: Command = { command: '/usr/bin/security', args: [] };
// errSecInteractionNotAllowed: the keychain is locked and nothing may ask for
// its password, as on a Mac no one has logged in to since it started.
const interactionNotAllowed = 36;

export async function signInState(machine: Machine, security: Command = macSecurity): Promise<SignIn> {
  for (const name of keyVariables) if (machine.env[name]) return { state: 'signed_in', how: name };
  for (const name of cloudVariables) if (machine.env[name] && machine.env[name] !== '0') return { state: 'signed_in', how: name };
  const directory = configDirectory(machine);
  const settings = await json(join(directory, 'settings.json'));
  if (settings && typeof settings.apiKeyHelper === 'string' && settings.apiKeyHelper !== '') return { state: 'signed_in', how: 'apiKeyHelper' };
  const credentials = await json(join(directory, '.credentials.json'));
  if (credentials) {
    const oauth = (credentials.claudeAiOauth ?? credentials) as Record<string, unknown>;
    if (typeof oauth.refreshToken === 'string' && oauth.refreshToken !== '') return { state: 'signed_in', how: 'credentials' };
    if (typeof oauth.accessToken === 'string' && oauth.accessToken !== '') {
      const expiresAt = expiry(oauth.expiresAt ?? oauth.expires_at);
      if (expiresAt !== null && expiresAt < machine.now()) return { state: 'expired' };
      return { state: 'signed_in', how: 'credentials' };
    }
  }
  const legacy = await json(join(machine.env.CLAUDE_CONFIG_DIR ? directory : homeOf(machine), '.claude.json'));
  if (legacy && typeof legacy.primaryApiKey === 'string' && legacy.primaryApiKey !== '') return { state: 'signed_in', how: 'primaryApiKey' };
  if (machine.platform === 'darwin') {
    const found = await run(machine, security, ['find-generic-password', '-s', 'Claude Code-credentials'], { timeoutMilliseconds: 5_000 });
    if (found.code === interactionNotAllowed || (await keychainLocked(machine, security))) return { state: 'keychain_locked' };
    if (found.code === 0) return { state: 'signed_in', how: 'keychain' };
  }
  return { state: 'signed_out' };
}

// Finding the item reads none of its secret, which Claude Code cannot read
// while the keychain is locked, so a locked keychain is asked about apart.
async function keychainLocked(machine: Machine, security: Command): Promise<boolean> {
  const shown = await run(machine, security, ['show-keychain-info'], { timeoutMilliseconds: 5_000 });
  return shown.code === interactionNotAllowed || /User interaction is not allowed/i.test(shown.stderr);
}
