# Claude Code

A Frontier Runtime that runs [Claude Code](https://code.claude.com) as an agent
on your workers. It is one of Frontier's Initial Applications, written against
Frontier's Application Interface (`interfaces/application.d.ts`) like any other
Application.

Claude Code needs a Claude subscription, such as Pro or Max, or an Anthropic API
key. You sign in once on each worker, in Claude Code itself. The Runtime never
holds or asks for your sign-in.

## What it does

On every worker, the worker bundle:

- **Probes** whether Claude Code is installed and signed in there, and which
  models it offers. The sign-in is read from `ANTHROPIC_API_KEY`,
  `CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_AUTH_TOKEN`, a cloud provider switch, an
  `apiKeyHelper`, the login Claude Code keeps in `~/.claude`, or the macOS
  keychain. A login that can refresh itself counts as signed in.
- **Installs** the Claude Code ACP adapter,
  `@agentclientprotocol/claude-agent-acp`, at the version this Application pins,
  into its own directory on the worker with npm. An adapter already on the PATH
  is used instead. A failed install is tried again after 1, 4, 16, then every 60
  minutes, and its reason shows meanwhile.
- **Lists models** by asking the Claude Agent SDK which models it supports, in
  the background, and keeps them for 12 hours. Each model is grouped by family,
  with the effort levels it supports as a setting.
- **Launches** one agent per session with `spawnAgent`, speaking version 1 of
  the Agent Client Protocol. The chosen model is set with `ANTHROPIC_MODEL`.

Claude Code takes an agent definition through options the Worker does not send,
so a small launcher sits between the Worker and the adapter. It passes every
message through untouched, except that it adds the session's options to
`_meta.claudeCode.options` of `session/new`, `session/load` and `session/resume`:

- An agent definition with instructions becomes Claude Code's main agent
  (`agent` and `agents`), with its description, tools, disallowed tools and model.
- A definition with only tool limits sets `tools` and `disallowedTools`.
- A model version's effort setting becomes `effort`.

The launcher is a process `spawnAgent` started, so a session survives a reload
of this Application as the interface promises.

The surface bundle's **configuration view** shows Claude Code's state on every
worker, its models, and how to sign in.

## Layout

| Path | What |
| --- | --- |
| `contributions.json` | The Application as data: its runtime and configuration view. |
| `worker.ts`, `src/runtime.ts` | The runtime: probe, install and launch. |
| `src/signin.ts` | Reading whether Claude Code is signed in. |
| `src/models.ts` | Turning Claude Code's models into the interface's models. |
| `src/definition.ts` | Reading an agent definition's front matter. |
| `src/scripts.ts` | The launcher and the model listing script written to the worker. |
| `src/installer.ts`, `src/machine.ts` | Finding npm and running installs once at a time. |
| `surface.ts`, `src/status-view.ts` | The configuration view. |
| `translations.json` | Every message a person reads, by token. |
| `test/` | Unit tests, with a fake npm, a fake adapter speaking ACP and a fake SDK. |

## Checking it

```sh
node scripts/check.mjs
```

It type-checks the sources against a Frontier checkout's Application Interface,
runs the tests with Node's test runner, and bundles each entry file the way the
Host does. It looks for the checkout at `../../frontier`, or at `FRONTIER_REPO`.
No test installs anything from the network or calls a model.

## License

MIT
