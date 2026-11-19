# Claude Code

A Frontier Runtime that runs [Claude Code](https://code.claude.com) as an agent
on your workers. It is one of Frontier's Initial Applications, written against
Frontier's Application Interface (`interfaces/application.d.ts`) like any other
Application.

Its id is `github.com/frontierengineer/application-claude-code`, the repository it
is published from.

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
  is used instead. npm is given 10 minutes; a failed or stalled install is tried
  again after 1, 4, 16, then every 60 minutes, and its reason shows meanwhile.
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

Every process the Runtime runs has a deadline, so a probe always answers: the
macOS keychain check it makes is given 5 seconds, and the model listing in the
background 90.

The surface bundle's **configuration view** shows Claude Code's state on every
worker, its models, and how to sign in. It is plain HTML and `frontier-*`
elements, drawn by Frontier's Design System in the person's own appearance.

## Layout

| Path | What |
| --- | --- |
| `contributions.json` | The Application as data: its runtime and configuration view. |
| `worker.ts`, `src/runtime.ts` | The runtime: probe, install and launch. |
| `src/signin.ts` | Reading whether Claude Code is signed in. |
| `src/models.ts` | Turning Claude Code's models into the interface's models. |
| `src/definition.ts` | Reading an agent definition's front matter. |
| `src/scripts.ts` | The launcher and the model listing script written to the worker. |
| `src/installer.ts`, `src/machine.ts` | Finding npm, running installs once at a time, and running processes with a deadline. |
| `surface.ts`, `src/status-view.ts` | The configuration view. |
| `translations.json` | Every message a person reads, by token. |
| `test/` | Unit tests, with a fake npm, a fake adapter speaking ACP and a fake SDK, and a browser test of the configuration view. |

## Developing

The Application is checked the way it ships, against a Frontier checkout:

```sh
npm test            # or: node scripts/check.mjs
```

It type-checks every bundle against the checkout's Application Interface
(`interfaces/application.d.ts`), runs the tests with Node's test runner, and
bundles each entry file the way the Host does. It finds the checkout at
`../../frontier` (a `frontier` beside the directory holding this repository), or
at `FRONTIER_REPO`, and borrows TypeScript, esbuild, Playwright and Node's types from it,
so that checkout's dependencies must be installed. It needs Node.js 22.6 or
later. No test reaches the network, calls a model or installs anything: npm, the adapter and the Claude Agent SDK are fakes under `test/fixtures/`.

The browser test draws the configuration view inside the Design System the
checkout provides, in the dark and the light scheme; with `VIEW_SHOTS=<directory>`
it keeps a screenshot of each.

To try it in Frontier itself, put this repository in the `applications`
directory beside a Frontier checkout, as `claude-code`; a Source Build of that
checkout carries every Application there as an Initial Application, so a new
install starts with it. From the checkout, `bash modcon/scripts/tool.sh ui
--remake --applications <that directory>` makes the Electron app with them and
photographs it.

## License

MIT, as `LICENSE` states.
