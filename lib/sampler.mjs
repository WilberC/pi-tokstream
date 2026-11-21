// Core throughput sampler (producer-only). Measures the main model's output
// rate while streaming and keeps the final provider-reported usage. It
// distinguishes estimated values (streaming) from reported ones (usage in
// the finalized message) — renderers must never present an estimate as
// reported data.

// Minimum gap between journal 'sample' writes. A synchronous journal append
// per text delta runs inside Pi's streaming path and blocks the TUI echo;
// coalescing keeps at most one sample write per window while the stream is
// live. The final state is flushed at message/turn end, so the last recorded
// sample always reflects the end of the stream.
export const SAMPLE_MIN_INTERVAL_MS = 500;

export function createSampleThrottle({ minIntervalMs = SAMPLE_MIN_INTERVAL_MS, now = () => Date.now() } = {}) {
  let lastWriteAt = null;
  let pendingTps = null;

  return {
    // offer records the latest measured value. Returns true when the caller
    // should append it now (first value, or the interval has elapsed);
    // otherwise the value is coalesced into the next write.
    offer(tps, ts = now()) {
      if (tps == null) return false;
      if (lastWriteAt != null && ts - lastWriteAt < minIntervalMs) {
        pendingTps = tps;
        return false;
      }
      lastWriteAt = ts;
      pendingTps = null;
      return true;
    },

    // flush returns the last coalesced value when a write is still pending,
    // or null when the last write already reflects the final state. Never
    // invents a value: a stream without a measured sample flushes nothing.
    flush(ts = now()) {
      if (pendingTps == null) return null;
      const tps = pendingTps;
      pendingTps = null;
      lastWriteAt = ts;
      return tps;
    },

    reset() {
      lastWriteAt = null;
      pendingTps = null;
    },
  };
}

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
