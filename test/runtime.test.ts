import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Failure, LaunchedAgent, RuntimeImplementation, RuntimeLaunchInput, RuntimeProbe } from '../../application';
import { adapterVersion, createClaudeRuntime } from '../src/runtime.ts';
import { eventually, harness, request } from './harness.ts';

function runtimeOf(h: ReturnType<typeof harness>): RuntimeImplementation {
  return createClaudeRuntime(h.context, h.machine);
}

function probeOf(answer: unknown): RuntimeProbe {
  assert.ok(answer && typeof answer === 'object' && 'ready' in answer, `expected a probe, got ${JSON.stringify(answer)}`);
  return answer as RuntimeProbe;
}

function failureOf(answer: unknown): Failure {
  assert.ok(answer && typeof answer === 'object' && 'ok' in answer && answer.ok === false, `expected a failure, got ${JSON.stringify(answer)}`);
  return answer as Failure;
}

const launchInput = (directory: string, extra: Partial<RuntimeLaunchInput> = {}): RuntimeLaunchInput => ({
  directory,
  options: {},
  model: null,
  agentDefinition: '',
  environment: { FROM_WORKER: 'yes' },
  ...extra,
});

test('a worker without Claude Code reports it missing, and install puts the pinned adapter in the private directory', async () => {
  const h = harness();
  const runtime = runtimeOf(h);
  const missing = probeOf(await runtime.probe());
  assert.equal(missing.ready, false);
  assert.equal(missing.missing, true);
  assert.equal(missing.reason, 'Claude Code is not installed on this worker yet. It is installed automatically.');
  h.machine.env.FAKE_NPM_LOG = join(h.base, 'npm.json');
  assert.equal(await runtime.install(), undefined);
  const args = JSON.parse(readFileSync(join(h.base, 'npm.json'), 'utf8')) as string[];
  assert.deepEqual(args.slice(0, 3), ['install', '--prefix', join(h.base, 'private', 'agent')]);
  assert.equal(args[args.length - 1], `@agentclientprotocol/claude-agent-acp@${adapterVersion}`);
  const signedOut = probeOf(await runtime.probe());
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.missing, undefined);
  const cli = join(h.base, 'private', 'agent', 'node_modules', '@anthropic-ai', 'claude-agent-sdk-linux-x64', 'claude');
  assert.equal(signedOut.reason, `Claude Code is not signed in on this worker. Open a terminal on the worker and run \`"${cli}" auth login\`, or set ANTHROPIC_API_KEY in the worker's environment.`);
});

test('a signed-in worker is ready and reports the models Claude Code lists, grouped by family with their effort levels', async () => {
  const h = harness();
  h.machine.env.ANTHROPIC_API_KEY = 'sk-test';
  const runtime = runtimeOf(h);
  assert.equal(await runtime.install(), undefined);
  const probe = await eventually(async () => probeOf(await runtime.probe()), (answer) => (answer.models?.length ?? 0) > 0);
  assert.equal(probe.ready, true);
  assert.equal(probe.reason, undefined);
  assert.deepEqual(probe.models?.map((model) => model.label), ['Claude Opus', 'Claude Sonnet', 'Claude Haiku']);
  const opus = probe.models?.[0];
  assert.deepEqual(opus?.versions.map((version) => version.id), ['opus', 'claude-opus-5-5[1m]']);
  assert.equal(opus?.versions[1]?.contextWindow, 1_000_000);
  assert.deepEqual(opus?.versions[0]?.settings, [{
    type: 'select',
    key: 'effort',
    label: 'Effort',
    description: 'How hard Claude thinks before it answers.',
    choices: [
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'Extra high' },
      { value: 'max', label: 'Max' },
    ],
  }]);
  assert.equal(probe.models?.[1]?.versions[0]?.settings, undefined);
  const cached = JSON.parse(readFileSync(join(h.base, 'private', 'models.json'), 'utf8')) as { version: string };
  assert.equal(cached.version, adapterVersion);
  const reloaded = createClaudeRuntime(h.context, h.machine);
  assert.equal(probeOf(await reloaded.probe()).models?.length, 3);
});

test('a failed install is reported with npm\'s words, waits before it is tried again, then is tried again', async () => {
  const h = harness();
  h.machine.env.FAKE_NPM_FAIL = '1';
  const runtime = runtimeOf(h);
  const failed = failureOf(await runtime.install());
  assert.equal(failed.retriable, true);
  assert.equal(failed.message, 'Installing Claude Code did not finish: npm error code ENETUNREACH npm error network request to https://registry.npmjs.org failed.');
  const waiting = probeOf(await runtime.probe());
  assert.equal(waiting.missing, undefined);
  assert.match(waiting.reason ?? '', /did not finish: .*ENETUNREACH.*It is tried again in 1 min\.$/);
  h.advance(61_000);
  assert.equal(probeOf(await runtime.probe()).missing, true);
  assert.equal(failureOf(await runtime.install()).retriable, true);
  assert.match(probeOf(await runtime.probe()).reason ?? '', /tried again in 4 min/);
  delete h.machine.env.FAKE_NPM_FAIL;
  h.advance(5 * 60_000);
  assert.equal(await runtime.install(), undefined);
});

test('without npm the install says so', async () => {
  const h = harness();
  h.machine.env.PATH = '/nonexistent';
  const runtime = createClaudeRuntime(h.context, { ...h.machine, execPath: join(h.base, 'no-node', 'node') });
  assert.equal(failureOf(await runtime.install()).message, 'Installing Claude Code did not finish: npm is not on this worker.');
});

test('the sign-in is read from a key, a refreshable login, an expired login and an API key helper', async () => {
  const h = harness();
  const runtime = runtimeOf(h);
  await runtime.install();
  const reason = async () => probeOf(await runtime.probe());
  mkdirSync(join(h.home, '.claude'));
  writeFileSync(join(h.home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'a', expiresAt: Date.parse('2026-01-01') } }));
  assert.match((await reason()).reason ?? '', /^The Claude Code sign-in on this worker has expired\./);
  writeFileSync(join(h.home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: 'r', expiresAt: Date.parse('2026-01-01') } }));
  assert.equal((await reason()).ready, true);
  writeFileSync(join(h.home, '.claude', '.credentials.json'), '"garbage"');
  assert.equal((await reason()).ready, false);
  writeFileSync(join(h.home, '.claude', 'settings.json'), JSON.stringify({ apiKeyHelper: '~/bin/key' }));
  assert.equal((await reason()).ready, true);
});

test('an adapter already on the PATH is used and nothing is installed', async () => {
  const h = harness();
  h.machine.env.ANTHROPIC_API_KEY = 'sk-test';
  const own = join(h.base, 'global', 'lib', 'node_modules', '@agentclientprotocol', 'claude-agent-acp');
  mkdirSync(join(own, 'dist'), { recursive: true });
  writeFileSync(join(own, 'package.json'), JSON.stringify({ version: '9.9.9', type: 'module' }));
  writeFileSync(join(own, 'dist', 'index.js'), readFileSync(new URL('./fixtures/fake-adapter.mjs', import.meta.url)));
  chmodSync(join(own, 'dist', 'index.js'), 0o755);
  symlinkSync(join(own, 'dist', 'index.js'), join(h.fakeBin, 'claude-agent-acp'));
  const runtime = runtimeOf(h);
  const probe = probeOf(await runtime.probe());
  assert.equal(probe.ready, true);
  assert.equal(probe.missing, undefined);
  const launched = (await runtime.launch(launchInput(h.home))) as LaunchedAgent;
  const [, created] = await request(launched, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: h.home, mcpServers: [] } },
  ]);
  assert.equal((created?.result as { sessionId: string }).sessionId, 'session-1');
  const launch = JSON.parse(h.spawned[0]?.environment?.FRONTIER_CLAUDE_LAUNCH ?? '{}') as { command: string; args: string[] };
  assert.deepEqual(launch.args, [join(own, 'dist', 'index.js')]);
  await launched.stop();
});

test('launch starts the adapter through the launcher, applying the agent definition, model and effort at session start', async () => {
  const h = harness();
  h.machine.env.ANTHROPIC_API_KEY = 'sk-test';
  const runtime = runtimeOf(h);
  await runtime.install();
  const directory = join(h.base, 'workspace');
  mkdirSync(directory);
  const definition = [
    '---',
    'name: Code Reviewer',
    'description: Reviews changes before they merge',
    'tools: Read, Grep, Glob',
    'model: sonnet',
    '---',
    '',
    'You review code. Point out bugs first.',
  ].join('\n');
  const launched = await runtime.launch(launchInput(directory, { agentDefinition: definition, model: { modelId: 'opus', settings: { effort: 'high' } } }));
  assert.ok(launched && 'stream' in launched);
  const options = h.spawned[0]!;
  assert.equal(options.command, process.execPath);
  assert.deepEqual(options.args, [join(h.base, 'private', 'bin', 'claude-launch.mjs')]);
  assert.equal(options.cwd, directory);
  assert.equal(options.environment?.ANTHROPIC_MODEL, 'opus');
  assert.equal(options.environment?.FROM_WORKER, 'yes');
  const [initialized, created, other] = await request(launched, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: directory, mcpServers: [], _meta: { worker: { kept: true } } } },
    { jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'session-1', prompt: [{ type: 'text', text: 'hi' }] } },
  ]);
  assert.equal((initialized?.result as { protocolVersion: number }).protocolVersion, 1);
  const meta = (created?.result as { _meta: Record<string, unknown> })._meta;
  assert.deepEqual(meta.received, {
    worker: { kept: true },
    claudeCode: {
      options: {
        agent: 'code-reviewer',
        agents: {
          'code-reviewer': {
            description: 'Reviews changes before they merge',
            prompt: 'You review code. Point out bugs first.',
            tools: ['Read', 'Grep', 'Glob'],
            model: 'sonnet',
          },
        },
        effort: 'high',
      },
    },
  });
  assert.equal(meta.model, 'opus');
  assert.equal(meta.protocol, 'v1');
  assert.equal(meta.leaked, null);
  assert.equal(meta.cwd, directory);
  assert.equal(meta.fromWorker, 'yes');
  assert.deepEqual((other?.result as { echo: unknown }).echo, { jsonrpc: '2.0', id: 3, method: 'session/prompt', params: { sessionId: 'session-1', prompt: [{ type: 'text', text: 'hi' }] } });
  await launched.stop();
});

test('an empty agent definition adds nothing, and a definition without instructions only limits tools', async () => {
  const h = harness();
  h.machine.env.ANTHROPIC_API_KEY = 'sk-test';
  const runtime = runtimeOf(h);
  await runtime.install();
  const plain = (await runtime.launch(launchInput(h.home))) as LaunchedAgent;
  const [, plainSession] = await request(plain, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', id: 2, method: 'session/new', params: { cwd: h.home, mcpServers: [] } },
  ]);
  assert.equal((plainSession?.result as { _meta: { received: unknown; model: unknown } })._meta.received, null);
  assert.equal((plainSession?.result as { _meta: { model: unknown } })._meta.model, null);
  await plain.stop();
  const limited = (await runtime.launch(launchInput(h.home, { agentDefinition: '---\ndisallowedTools:\n  - Bash\n  - WebFetch\n---\n' }))) as LaunchedAgent;
  const [, limitedSession] = await request(limited, [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1 } },
    { jsonrpc: '2.0', id: 2, method: 'session/load', params: { sessionId: 'old', cwd: h.home, mcpServers: [] } },
  ]);
  assert.deepEqual((limitedSession?.result as { echo: { params: { _meta: unknown } } }).echo.params._meta, { claudeCode: { options: { disallowedTools: ['Bash', 'WebFetch'] } } });
  await limited.stop();
});

test('launch is refused with the reason while Claude Code is missing or signed out', async () => {
  const h = harness();
  const runtime = runtimeOf(h);
  assert.equal(failureOf(await runtime.launch(launchInput(h.home))).message, 'Claude Code is not installed on this worker yet. It is installed automatically, then the session starts.');
  await runtime.install();
  const refused = failureOf(await runtime.launch(launchInput(h.home)));
  assert.match(refused.message, /^Claude Code is not signed in on this worker\./);
  assert.equal(refused.retriable, true);
  assert.equal(h.spawned.length, 0);
});
