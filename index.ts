import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createSampler } from './lib/sampler.mjs';

// pi-tokstream: producer-only throughput data. Measures the main model's
// output rate while streaming and keeps provider-reported usage per message.
// Renders nothing: renderers (herdr-sidecar, Gentle Shell panels) consume
// snapshots and own all presentation. Estimates are always labeled as such.
export default function tokstream(pi: ExtensionAPI) {
  const sampler = createSampler();

  const countTextDeltas = (event: unknown): number => {
    const e = event as { assistantMessageEvent?: { type?: string; delta?: string } };
    return e?.assistantMessageEvent?.type === 'text_delta'
      ? Math.max(1, Math.ceil((e.assistantMessageEvent.delta ?? '').length / 4))
      : 0;
  };

  pi.on('message_update', async (event) => {
    const count = countTextDeltas(event);
    if (count > 0) sampler.delta(count);
  });

  pi.on('message_end', async (event) => {
    const message = (event as { message?: unknown }).message as
      | { role?: string; usage?: Record<string, number> }
      | undefined;
    if (message?.role === 'assistant' && message.usage) {
      sampler.usage(message.usage);
    }
  });

  pi.registerCommand('tokstream', {
    description: 'Token throughput data: current snapshot status',
    handler: async (_args, ctx) => {
      const s = sampler.snapshot();
      const tps = s.tps != null ? `${s.tps.toFixed(1)} tok/s` : 'n/a';
      ctx.ui.notify(
        `tokstream: ${tps} (${s.source ?? 'no data'})`,
        'info',
      );
    },
  });
}
