// Core throughput sampler (producer-only). Measures the main model's output
// rate while streaming and keeps the final provider-reported usage. It
// distinguishes estimated values (streaming) from reported ones (usage in
// the finalized message) — renderers must never present an estimate as
// reported data.

export function createSampler({ now = () => Date.now() } = {}) {
  const current = { active: false, estimatedTps: null, reportedTps: null, reported: null };
  let lastSnapshot = null;
  let snapshotCount = 0;
  let windowMs = 0;

  return {
    // One text_delta from the stream: accumulate output tokens.
    delta(count = 1, ts = now()) {
      if (!Number.isFinite(count) || count <= 0) return null;
      if (!current.active) {
        current.active = true;
        current.estimatedTps = null;
        lastSnapshot = { tokens: 0, ts };
        snapshotCount = 0;
        windowMs = 0;
      }
      lastSnapshot.tokens += count;
      snapshotCount += 1;
      const elapsed = ts - lastSnapshot.ts;
      if (elapsed > 0) {
        windowMs += elapsed;
        current.estimatedTps = windowMs > 0
          ? (lastSnapshot.tokens / windowMs) * 1000
          : null;
        lastSnapshot.ts = ts;
      }
      return current.estimatedTps;
    },

    // Finalized message: replace estimates with provider-reported usage.
    usage(usage, ts = now()) {
      const output = usage?.output ?? usage?.outputTokens ?? null;
      if (Number.isFinite(output) && output > 0) {
        const ms = current.active ? windowMs : null;
        current.reportedTps = ms && ms > 0
          ? (output / ms) * 1000
          : null;
        current.reported = {
          input: usage?.input ?? null,
          output,
          cacheRead: usage?.cacheRead ?? null,
          cacheWrite: usage?.cacheWrite ?? null,
        };
      }
      current.active = false;
      current.estimatedTps = null;
      return { reportedTps: current.reportedTps, reported: current.reported };
    },

    // Snapshot for consumers; reported vs estimated is explicit.
    snapshot() {
      return {
        active: current.active,
        tps: current.active ? current.estimatedTps : current.reportedTps,
        source: current.active
          ? 'estimated'
          : (current.reportedTps != null || current.reported != null ? 'reported' : null),
        reported: current.reported ? { ...current.reported } : null,
      };
    },

    reset() {
      current.active = false;
      current.estimatedTps = null;
      current.reportedTps = null;
      current.reported = null;
      lastSnapshot = null;
      snapshotCount = 0;
      windowMs = 0;
    },
  };
}
