export const launcherScript = `// Written by Frontier's Claude Code Runtime. Starts the Claude Code ACP adapter
// and passes ACP between it and the Worker untouched, except that it merges the
// session's options into _meta of session/new, session/load and session/resume.
import { spawn } from 'node:child_process';

const launch = JSON.parse(process.env.FRONTIER_CLAUDE_LAUNCH ?? '{}');
delete process.env.FRONTIER_CLAUDE_LAUNCH;
const methods = new Set(['session/new', 'session/load', 'session/resume', 'session/fork', 'session/resume_session']);
const child = spawn(launch.command, launch.args ?? [], { stdio: ['pipe', 'inherit', 'inherit'], env: process.env });

function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(ours, theirs) {
  if (!plain(ours)) return theirs === undefined ? ours : theirs;
  if (!plain(theirs)) return theirs === undefined ? ours : theirs;
  const merged = { ...ours };
  for (const [key, value] of Object.entries(theirs)) merged[key] = merge(ours[key], value);
  return merged;
}

function rewrite(line) {
  if (!launch.meta || !line.includes('"method"')) return line;
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return line;
  }
  if (!plain(message) || !methods.has(message.method) || !plain(message.params)) return line;
  message.params._meta = merge(launch.meta, message.params._meta);
  return JSON.stringify(message);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  let flowing = true;
  while ((newline = buffer.indexOf('\\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    flowing = child.stdin.write(rewrite(line) + '\\n') && flowing;
  }
  if (!flowing) {
    process.stdin.pause();
    child.stdin.once('drain', () => process.stdin.resume());
  }
});
process.stdin.on('end', () => {
  if (buffer.length > 0) child.stdin.write(rewrite(buffer));
  child.stdin.end();
});
child.stdin.on('error', () => undefined);
child.on('error', (error) => {
  process.stderr.write('The Claude Code ACP adapter could not start: ' + error.message + '\\n');
  process.exit(127);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
`;

export const modelsScript = `// Written by Frontier's Claude Code Runtime. Prints the models Claude Code
// offers on this machine as JSON, without starting a conversation.
const [sdk, cwd] = process.argv.slice(2);
const deadline = setTimeout(() => {
  process.stdout.write(JSON.stringify({ error: 'Claude Code did not list its models within a minute.' }));
  process.exit(2);
}, 60_000);
try {
  const { query } = await import(sdk);
  const never = (async function* () { await new Promise(() => undefined); })();
  const session = query({ prompt: never, options: { cwd, persistSession: false } });
  const models = await session.supportedModels();
  process.stdout.write(JSON.stringify({ models }));
  clearTimeout(deadline);
  try { session.close?.(); } catch {}
  process.exit(0);
} catch (error) {
  process.stdout.write(JSON.stringify({ error: String(error?.message ?? error) }));
  process.exit(1);
}
`;
