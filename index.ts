import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createSampler } from './lib/sampler.mjs';
import { createJournal } from './lib/journal.mjs';

// pi-tokstream: producer-only throughput data. Measures the main model's
// output rate while streaming and keeps provider-reported usage per message.
// Renders nothing: renderers (herdr-sidecar, Gentle Shell panels) consume
// snapshots and own all presentation. Estimates are always labeled as such.
export default function tokstream(pi: ExtensionAPI) {
  const sampler = createSampler();
  const journal = createJournal({ sessionId: '', producer: 'pi-tokstream' });

  const countTextDeltas = (event: unknown): number => {
    const e = event as { assistantMessageEvent?: { type?: string; delta?: string } };
    return e?.assistantMessageEvent?.type === 'text_delta'
      ? Math.max(1, Math.ceil((e.assistantMessageEvent.delta ?? '').length / 4))
      : 0;
  };

  pi.on('session_start', async (_event, ctx) => {
    journal.openSession(
      ctx.sessionManager?.getSessionFile?.(),
      ctx.sessionManager?.getSessionId?.(),
    );
  });
  pi.on('session_shutdown', () => journal.close());

  pi.on('message_update', async (event) => {
    const count = countTextDeltas(event);
    if (count > 0) {
      sampler.delta(count);
      const snap = sampler.snapshot();
      if (snap.active && snap.tps != null) {
        // Throttled live sample with a measured value only; consumers render
        // the last value. A sample without a value is not data.
        journal.append('sample', {
          tps: snap.tps,
          source: snap.source,
          ts: new Date().toISOString(),
        });
      }
    }
  });

  pi.on('message_end', async (event) => {
    const message = (event as { message?: unknown }).message as
      | { role?: string; usage?: Record<string, number> }
      | undefined;
    if (message?.role === 'assistant' && message.usage) {
      const r = sampler.usage(message.usage);
      journal.append('usage', {
        tps: r.reportedTps,
        source: r.reportedTps != null ? 'reported' : null,
        reported: r.reported,
      });
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
