import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentName, isEmptyDefinition, parseAgentDefinition } from '../src/definition.ts';
import { toRuntimeModels } from '../src/models.ts';

test('an agent definition is read from its front matter and body', () => {
  const definition = parseAgentDefinition('---\r\nname: "Planner"\r\ndescription: Plans work\r\ntools: [Read, "Grep"]\r\ndisallowed-tools: Bash\r\nmodel: inherit\r\n---\r\n\r\nPlan first.\r\n');
  assert.deepEqual(definition, {
    name: 'Planner',
    description: 'Plans work',
    tools: ['Read', 'Grep'],
    disallowedTools: ['Bash'],
    model: 'inherit',
    body: 'Plan first.',
  });
  assert.equal(agentName(definition), 'planner');
  assert.equal(agentName(parseAgentDefinition('Just instructions.')), 'frontier-session');
  assert.equal(parseAgentDefinition('Just instructions.').body, 'Just instructions.');
  assert.equal(isEmptyDefinition(parseAgentDefinition('')), true);
  assert.equal(isEmptyDefinition(parseAgentDefinition('---\nname: x\n---\n')), true);
  assert.equal(agentName(parseAgentDefinition('---\nname: default\n---\nx')), 'frontier-session');
});

test('models without a family keep their own name, and repeated ids are listed once', () => {
  const models = toRuntimeModels([
    { value: 'custom-gateway-model', displayName: 'Gateway model' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5' },
    { value: 'claude-sonnet-4-5', resolvedModel: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5', description: '200K context' },
    { value: 'sonnet', resolvedModel: 'claude-sonnet-5', displayName: 'Sonnet 5' },
  ]);
  assert.deepEqual(models, [
    {
      label: 'Claude Sonnet',
      versions: [
        { id: 'sonnet', label: 'Sonnet 5' },
        { id: 'claude-sonnet-4-5', label: 'Sonnet 4.5', contextWindow: 200_000 },
      ],
    },
    { label: 'Gateway model', versions: [{ id: 'custom-gateway-model', label: 'Gateway model' }] },
  ]);
});
