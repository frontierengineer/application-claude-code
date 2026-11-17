import { appendFileSync } from 'node:fs';

let buffer = '';
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (process.env.FAKE_ADAPTER_LOG) appendFileSync(process.env.FAKE_ADAPTER_LOG, `${line}\n`);
    const message = JSON.parse(line);
    if (message.method === 'initialize') send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    else if (message.method === 'session/new') {
      send({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          sessionId: 'session-1',
          _meta: {
            received: message.params._meta ?? null,
            model: process.env.ANTHROPIC_MODEL ?? null,
            protocol: process.env.CLAUDE_AGENT_ACP_PROTOCOL ?? null,
            leaked: process.env.FRONTIER_CLAUDE_LAUNCH ?? null,
            cwd: process.cwd(),
            fromWorker: process.env.FROM_WORKER ?? null,
          },
        },
      });
    } else if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: { echo: message } });
  }
});
process.stdin.on('end', () => process.exit(0));
