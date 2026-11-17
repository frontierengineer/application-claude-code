import type { Field, RuntimeModel, RuntimeModelVersion } from '../../application';

export interface ClaudeModelInfo {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description?: string;
  supportedEffortLevels?: string[];
}

const families = ['fable', 'mythos', 'opus', 'sonnet', 'haiku'];

function familyOf(model: ClaudeModelInfo): string | null {
  const words = `${model.value} ${model.resolvedModel ?? ''} ${model.displayName}`.toLowerCase().split(/[^a-z0-9]+/);
  return families.find((family) => words.includes(family)) ?? null;
}

function versionNumber(model: ClaudeModelInfo): number {
  const match = /(\d+)(?:[-.](\d+))?/.exec(`${model.resolvedModel ?? ''} ${model.displayName}`.replace(/\[\d+m\]/i, ''));
  return match ? Number(match[1]) + Number(match[2] ?? 0) / 100 : 0;
}

function contextWindowOf(model: ClaudeModelInfo): number | null {
  const hint = /\[(\d+)m\]/i.exec(model.value) ?? /\[(\d+)m\]/i.exec(model.resolvedModel ?? '');
  if (hint) return Number(hint[1]) * 1_000_000;
  const described = /\b(\d+(?:\.\d+)?)\s*([mk])\b[^.]*context/i.exec(`${model.displayName} ${model.description ?? ''}`);
  if (!described) return null;
  return Math.round(Number(described[1]) * (described[2]?.toLowerCase() === 'm' ? 1_000_000 : 1_000));
}

const effortLabels: Record<string, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' };

export function effortField(levels: readonly string[]): Field {
  return {
    type: 'select',
    key: 'effort',
    label: 'Effort',
    description: 'How hard Claude thinks before it answers.',
    choices: levels.map((level) => ({ value: level, label: effortLabels[level] ?? level })),
  };
}

export function toRuntimeModels(infos: readonly ClaudeModelInfo[]): RuntimeModel[] {
  const groups = new Map<string, { label: string; versions: { order: number; version: RuntimeModelVersion }[] }>();
  for (const info of infos) {
    if (info.value === 'default' || typeof info.value !== 'string' || info.value === '') continue;
    const family = familyOf(info);
    const key = family ?? info.value;
    const label = family ? `Claude ${family[0]!.toUpperCase()}${family.slice(1)}` : info.displayName || info.value;
    const version: RuntimeModelVersion = { id: info.value, label: info.displayName || info.value };
    const contextWindow = contextWindowOf(info);
    if (contextWindow !== null) version.contextWindow = contextWindow;
    if (info.supportedEffortLevels && info.supportedEffortLevels.length > 0) version.settings = [effortField(info.supportedEffortLevels)];
    const group = groups.get(key) ?? { label, versions: [] };
    if (!group.versions.some((existing) => existing.version.id === version.id)) group.versions.push({ order: versionNumber(info), version });
    groups.set(key, group);
  }
  const order = (label: string) => {
    const index = families.findIndex((family) => label.toLowerCase().endsWith(family));
    return index === -1 ? families.length : index;
  };
  return [...groups.values()]
    .sort((a, b) => order(a.label) - order(b.label))
    .map((group) => ({ label: group.label, versions: group.versions.sort((a, b) => b.order - a.order).map((entry) => entry.version) }));
}
