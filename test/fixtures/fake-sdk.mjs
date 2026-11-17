export function query({ options }) {
  if (options.persistSession !== false) throw new Error('enumeration must not persist a session');
  return {
    async supportedModels() {
      return [
        { value: 'default', displayName: 'Default (recommended)', description: 'Opus 5.5' },
        { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Most capable', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        { value: 'claude-opus-5-5[1m]', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5 (1M context)', description: 'For long sessions', supportedEffortLevels: ['low', 'high'] },
        { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', description: 'Fast' },
        { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: 'Fastest' },
      ];
    },
    close() {},
  };
}
