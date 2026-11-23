import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  Failure,
  LaunchedAgent,
  RuntimeContext,
  RuntimeImplementation,
  RuntimeLaunchInput,
  RuntimeModel,
  RuntimeProbe,
  Unavailable,
} from '../../application';
import { agentName, isEmptyDefinition, parseAgentDefinition } from './definition.ts';
import { type InstallOutcome, Installer, npmInstall } from './installer.ts';
import { type Command, type Machine, firstExecutable, nodeAware, realMachine, run, which } from './machine.ts';
import { type ClaudeModelInfo, toRuntimeModels } from './models.ts';
import { launcherScript, modelsScript } from './scripts.ts';
import { signInState } from './signin.ts';
import { failure, text } from './text.ts';
import { judgeVersion } from './version.ts';

export const adapterPackage = '@agentclientprotocol/claude-agent-acp';
export const adapterVersion = '0.108.0';
// An adapter on the PATH older than this, or of another major version, is
// passed over for the one installed at adapterVersion.
export const adapterMinimum = '0.108.0';

const refreshAfterMilliseconds = 12 * 60 * 60 * 1000;
const retryRefreshAfterMilliseconds = 10 * 60 * 1000;

interface Adapter {
  command: Command;
  entry: string;
  version: string | null;
}

interface ModelCache {
  version: string;
  at: number;
  models: RuntimeModel[];
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function writeIfChanged(path: string, content: string): Promise<void> {
  const existing = await readFile(path, 'utf8').catch(() => null);
  if (existing !== content) await writeFile(path, content);
}

export function createClaudeRuntime(context: RuntimeContext, machine: Machine = realMachine): RuntimeImplementation {
  const t = (token: string, values: Record<string, string | number> = {}) => text(context, token, values);
  const prefix = join(context.directories.private, 'agent');
  const bin = join(context.directories.private, 'bin');
  const launcherPath = join(bin, 'claude-launch.mjs');
  const modelsPath = join(bin, 'claude-models.mjs');
  const cachePath = join(context.directories.private, 'models.json');
  const installer = new Installer(machine);
  let cache: ModelCache | null | undefined;
  let refreshing: Promise<void> | null = null;
  let refreshFailedAt = 0;

  async function writeScripts(): Promise<void> {
    await mkdir(bin, { recursive: true });
    await writeIfChanged(launcherPath, launcherScript);
    await writeIfChanged(modelsPath, modelsScript);
  }

  async function privateAdapter(): Promise<Adapter | null> {
    const manifest = join(prefix, 'node_modules', ...adapterPackage.split('/'), 'package.json');
    const pkg = await readJson(manifest);
    if (!pkg) return null;
    const bins = pkg.bin;
    const relative = typeof bins === 'string' ? bins : bins && typeof bins === 'object' ? (bins as Record<string, string>)['claude-agent-acp'] : undefined;
    const entry = join(dirname(manifest), relative ?? 'dist/index.js');
    if (!existsSync(entry)) return null;
    return { command: { command: machine.execPath, args: [entry] }, entry, version: typeof pkg.version === 'string' ? pkg.version : null };
  }

  async function pathAdapter(): Promise<Adapter | null> {
    const found = await which(machine, 'claude-agent-acp');
    if (!found) return null;
    const command = await nodeAware(machine, found);
    const entry = command.args[0] ?? command.command;
    const pkg = await readJson(join(dirname(dirname(entry)), 'package.json'));
    return { command, entry, version: pkg && typeof pkg.version === 'string' ? pkg.version : null };
  }

  let said = '';
  function say(key: string, message: string, fields: Record<string, string>): void {
    if (key === said) return;
    said = key;
    void context.logger.info(message, fields);
  }

  async function locateAdapter(): Promise<Adapter | null> {
    const fromPath = await pathAdapter();
    let passedOver = '';
    if (fromPath) {
      const verdict = judgeVersion(fromPath.version, adapterMinimum);
      if (verdict.usable) {
        say(`path ${fromPath.entry} ${fromPath.version}`, t('log.adapter_path', { version: fromPath.version ?? '', path: fromPath.entry }), { path: fromPath.entry, version: fromPath.version ?? '' });
        return fromPath;
      }
      const values = { version: fromPath.version ?? '', path: fromPath.entry, minimum: adapterMinimum };
      passedOver = verdict.why === 'older' ? t('log.adapter_passed_over_older', values)
        : verdict.why === 'newer_major' ? t('log.adapter_passed_over_newer_major', values)
          : t('log.adapter_passed_over_unknown', values);
    }
    const installed = await privateAdapter();
    const usable = installed && installed.version === adapterVersion ? installed : null;
    if (usable) say(`private ${usable.entry} ${passedOver}`, [t('log.adapter_private', { version: adapterVersion }), passedOver].filter(Boolean).join(' '), { path: usable.entry, version: adapterVersion });
    else if (passedOver) say(`none ${passedOver}`, passedOver, { path: fromPath?.entry ?? '' });
    return usable;
  }

  function sdkOf(adapter: Adapter): string | null {
    if (!/\.(c|m)?js$/.test(adapter.entry)) return null;
    try {
      return createRequire(adapter.entry).resolve('@anthropic-ai/claude-agent-sdk');
    } catch {
      return null;
    }
  }

  async function bundledCli(adapter: Adapter): Promise<string | null> {
    const sdk = sdkOf(adapter);
    if (!sdk) return null;
    const scopes = [dirname(dirname(sdk)), join(dirname(sdk), 'node_modules', '@anthropic-ai')];
    for (const scope of scopes) {
      let entries: string[];
      try {
        entries = await readdir(scope);
      } catch {
        continue;
      }
      for (const entry of entries.filter((name) => name.startsWith('claude-agent-sdk-'))) {
        const found = await firstExecutable(['claude', 'claude.exe', join('dist', 'claude'), join('dist', 'claude.exe')].map((file) => join(scope, entry, file)));
        if (found) return found;
      }
    }
    return null;
  }

  async function signInCommand(adapter: Adapter | null): Promise<string> {
    if (await which(machine, 'claude')) return 'claude auth login';
    const cli = adapter ? await bundledCli(adapter) : null;
    return cli ? `"${cli}" auth login` : 'claude auth login';
  }

  async function loadCache(): Promise<ModelCache | null> {
    if (cache === undefined) {
      const stored = await readJson(cachePath);
      cache = stored && typeof stored.version === 'string' && Array.isArray(stored.models) ? (stored as unknown as ModelCache) : null;
    }
    return cache;
  }

  function refreshModels(adapter: Adapter, force = false): Promise<void> {
    if (refreshing) return refreshing;
    if (!force && machine.now() - refreshFailedAt < retryRefreshAfterMilliseconds) return Promise.resolve();
    const sdk = sdkOf(adapter);
    if (!sdk) return Promise.resolve();
    refreshing = (async () => {
      try {
        await writeScripts();
        const ran = await run(machine, { command: machine.execPath, args: [modelsPath] }, [pathToFileURL(sdk).href, context.directories.scratch], { cwd: context.directories.scratch, timeoutMilliseconds: 90_000 });
        let parsed: { models?: ClaudeModelInfo[]; error?: string } = {};
        try {
          parsed = JSON.parse(ran.stdout) as typeof parsed;
        } catch {
          parsed = { error: ran.error ?? ran.stderr.trim().slice(0, 300) };
        }
        if (!Array.isArray(parsed.models)) throw new Error(parsed.error ?? 'no models were listed');
        cache = { version: adapter.version ?? 'unknown', at: machine.now(), models: toRuntimeModels(parsed.models) };
        await writeFile(cachePath, JSON.stringify(cache));
        refreshFailedAt = 0;
      } catch (error) {
        refreshFailedAt = machine.now();
        void context.logger.warn('Claude Code did not list its models', { reason: error instanceof Error ? error.message : String(error) });
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  async function currentModels(adapter: Adapter, signedIn: boolean): Promise<RuntimeModel[]> {
    const stored = await loadCache();
    const fresh = stored !== null && stored.version === (adapter.version ?? 'unknown');
    if (signedIn && (!fresh || machine.now() - (stored?.at ?? 0) > refreshAfterMilliseconds)) void refreshModels(adapter);
    return fresh && stored ? stored.models : [];
  }

  async function probe(): Promise<RuntimeProbe | Failure | Unavailable> {
    try {
      if (installer.busy) return { ready: false, reason: t('probe.installing') };
      const adapter = await locateAdapter();
      if (!adapter) {
        const failed = installer.failure();
        if (failed) {
          const minutes = Math.max(1, Math.ceil((failed.retryAt - machine.now()) / 60_000));
          return { ready: false, reason: t('probe.install_failed', { reason: failed.message, minutes }) };
        }
        return { ready: false, missing: true, reason: t('probe.missing') };
      }
      const signIn = await signInState(machine);
      const models = await currentModels(adapter, signIn.state === 'signed_in');
      const answer: RuntimeProbe = { ready: signIn.state === 'signed_in' };
      if (signIn.state === 'signed_out') answer.reason = t('probe.signed_out', { command: await signInCommand(adapter) });
      if (signIn.state === 'expired') answer.reason = t('probe.expired', { command: await signInCommand(adapter) });
      if (signIn.state === 'keychain_locked') answer.reason = t('probe.keychain_locked');
      if (models.length > 0) answer.models = models;
      return answer;
    } catch (error) {
      return failure(t('probe.could_not_run', { reason: error instanceof Error ? error.message : String(error) }), true);
    }
  }

  function installReason(outcome: Extract<InstallOutcome, { ok: false }>): string {
    if (!outcome.unreached) return outcome.reason;
    const { host, code, certificate } = outcome.unreached;
    return t(certificate ? 'install.untrusted_certificate' : 'install.unreachable', { host, code });
  }

  async function install(): Promise<void | Failure | Unavailable> {
    const outcome = await installer.run(async () => {
      await mkdir(prefix, { recursive: true });
      const installed = await npmInstall(machine, prefix, `${adapterPackage}@${adapterVersion}`);
      if (!installed.ok) return { ok: false, reason: installReason(installed) };
      const adapter = await privateAdapter();
      if (!adapter || adapter.version !== adapterVersion) return { ok: false, reason: t('install.not_found_after') };
      return { ok: true };
    });
    if (!outcome.ok) return failure(t('install.failed', { reason: outcome.reason }), true);
    void context.logger.info('Installed Claude Code', { package: `${adapterPackage}@${adapterVersion}` });
    await writeScripts();
    const adapter = await locateAdapter();
    if (adapter && (await signInState(machine)).state === 'signed_in') void refreshModels(adapter, true);
  }

  async function launch(input: RuntimeLaunchInput): Promise<LaunchedAgent | Failure | Unavailable> {
    const adapter = await locateAdapter();
    if (!adapter) return failure(t('launch.missing'), true);
    const signIn = await signInState(machine);
    if (signIn.state === 'signed_out') return failure(t('probe.signed_out', { command: await signInCommand(adapter) }), true);
    if (signIn.state === 'expired') return failure(t('probe.expired', { command: await signInCommand(adapter) }), true);
    if (signIn.state === 'keychain_locked') return failure(t('probe.keychain_locked'), true);
    await writeScripts();
    const definition = parseAgentDefinition(input.agentDefinition);
    const options: Record<string, unknown> = {};
    if (!isEmptyDefinition(definition)) {
      if (definition.body !== '') {
        const name = agentName(definition);
        const agent: Record<string, unknown> = { description: definition.description ?? t('launch.agent_description'), prompt: definition.body };
        if (definition.tools) agent.tools = definition.tools;
        if (definition.disallowedTools) agent.disallowedTools = definition.disallowedTools;
        if (definition.model && definition.model !== 'inherit') agent.model = definition.model;
        options.agent = name;
        options.agents = { [name]: agent };
      } else {
        if (definition.tools) options.tools = definition.tools;
        if (definition.disallowedTools) options.disallowedTools = definition.disallowedTools;
      }
    }
    const effort = input.model?.settings.effort;
    if (typeof effort === 'string' && effort !== '') options.effort = effort;
    const environment: Record<string, string> = {
      ...input.environment,
      CLAUDE_AGENT_ACP_PROTOCOL: 'v1',
      FRONTIER_CLAUDE_LAUNCH: JSON.stringify({
        command: adapter.command.command,
        args: adapter.command.args,
        meta: Object.keys(options).length > 0 ? { claudeCode: { options } } : null,
      }),
    };
    const model = input.model?.modelId ?? (definition.model && definition.model !== 'inherit' ? definition.model : null);
    if (model) environment.ANTHROPIC_MODEL = model;
    const spawned = await context.spawnAgent({ command: machine.execPath, args: [launcherPath], cwd: input.directory, environment });
    if (!spawned.ok) return spawned;
    return spawned.value;
  }

  void writeScripts().catch((error: unknown) => void context.logger.warn('The launch scripts could not be written', { reason: String(error) }));

  return { probe, install, launch };
}
