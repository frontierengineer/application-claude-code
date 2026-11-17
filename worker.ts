import type { WorkerRegistration } from '../application';
import { createClaudeRuntime } from './src/runtime.ts';

export const registration = {
  runtime: {
    mount(context) {
      return createClaudeRuntime(context);
    },
  },
} satisfies WorkerRegistration;
