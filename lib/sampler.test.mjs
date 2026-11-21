import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSampler, createSampleThrottle, SAMPLE_MIN_INTERVAL_MS } from './sampler.mjs';

const tick = (start) => (step) => start + step * 100; // 100 ms per step

test('estimated tps while streaming, source=estimated', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  assert.equal(s.snapshot().tps, null);
  s.delta(10, t(1));
  s.delta(10, t(2)); // 20 tokens in 100 ms -> 200 tok/s
  const snap = s.snapshot();
  assert.equal(snap.source, 'estimated');
  assert.ok(Math.abs(snap.tps - 200) < 0.001, `got ${snap.tps}`);
  assert.equal(snap.reported, null);
});

test('usage replaces the estimate; reported tps recomputed from usage', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  s.delta(10, t(1));
  s.delta(10, t(2));
  const r = s.usage({ input: 100, output: 18, cacheRead: 5, cacheWrite: 0 }, t(3));
  // 18 reported tokens over the 100 ms measured window -> 180 tok/s
  assert.ok(Math.abs(r.reportedTps - 180) < 0.001, `got ${r.reportedTps}`);
  assert.deepEqual(r.reported, { input: 100, output: 18, cacheRead: 5, cacheWrite: 0 });
  const snap = s.snapshot();
  assert.equal(snap.source, 'reported');
  assert.ok(Math.abs(snap.tps - 180) < 0.001);
});

test('reported usage wins even without deltas (aborted or non-streamed run)', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  s.usage({ output: 50 }, t(1));
  const snap = s.snapshot();
  assert.equal(snap.source, 'reported');
  assert.equal(snap.active, false);
  assert.equal(snap.reported.output, 50);
  assert.equal(snap.tps, null); // no measured window: no invented tps
});

test('deltas are ignored when not positive-finite', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  assert.equal(s.delta(0), null);
  assert.equal(s.delta(-3), null);
  assert.equal(s.delta(Number.NaN), null);
  assert.equal(s.snapshot().active, false);
});

test('usage with no output keeps nulls; reset clears everything', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  s.delta(5, t(1));
  s.usage({}, t(2));
  assert.equal(s.snapshot().source, null);
  s.delta(5, t(3));
  s.usage({ output: 10 }, t(4));
  s.reset();
  const snap = s.snapshot();
  assert.equal(snap.active, false);
  assert.equal(snap.tps, null);
  assert.equal(snap.source, null);
  assert.equal(snap.reported, null);
});

test('sample throttle collapses writes inside the interval and flush keeps the final state (T1)', () => {
  const t = tick(1000);
  const gate = createSampleThrottle({ minIntervalMs: 500, now: () => t(0) });
  assert.equal(SAMPLE_MIN_INTERVAL_MS, 500);
  assert.equal(gate.offer(null, t(1)), false); // no measured value, no write
  assert.equal(gate.offer(120, t(1)), true); // leading edge writes
  assert.equal(gate.offer(180, t(2)), false); // inside the 500 ms window
  assert.equal(gate.offer(240, t(3)), false);
  assert.equal(gate.flush(t(4)), 240); // final state, not the stale 120
  assert.equal(gate.flush(t(5)), null); // nothing pending: no duplicate write
});

test('sample throttle writes again once the interval has elapsed (T1)', () => {
  const t = tick(1000);
  const gate = createSampleThrottle({ minIntervalMs: 500, now: () => t(0) });
  assert.equal(gate.offer(100, t(1)), true);
  assert.equal(gate.offer(110, t(5)), false); // 400 ms: still coalesced
  assert.equal(gate.offer(120, t(6)), true); // 500 ms: new write
  assert.equal(gate.flush(t(7)), null);
});

test('next stream after usage starts a fresh estimate', () => {
  const t = tick(1000);
  const s = createSampler({ now: t });
  s.delta(10, t(1));
  s.usage({ output: 10 }, t(2));
  s.delta(10, t(3));
  s.delta(10, t(4)); // 20 tokens in 100 ms
  const snap = s.snapshot();
  assert.equal(snap.source, 'estimated');
  assert.equal(snap.active, true);
  assert.equal(snap.tps, 200);
});
