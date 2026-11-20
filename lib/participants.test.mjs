import { test } from 'node:test';
import assert from 'node:assert/strict';
import { participantForTask } from './participants.mjs';

const taskJson = JSON.stringify({
  id: 'mwpasz67-2-w828',
  agent: 'gentle-ai-explore',
  status: 'completed',
  label: 'map tui-kit',
  sessionPath: '/home/x/.gentle-shell/agent/gentle-agents/sessions/20261120_abcd.jsonl',
});

const childUsage = {
  v: 1,
  producer: 'pi-tokstream',
  sessionId: '01a1fa48-child',
  ts: '2026-11-20T18:40:00.000Z',
  type: 'usage',
  data: { tps: 41.5, source: 'reported', reported: { input: 900, output: 412, cacheRead: 10, cacheWrite: null } },
};
const childSample = {
  v: 1,
  producer: 'pi-tokstream',
  sessionId: '01a1fa48-child',
  ts: '2026-11-20T18:39:00.000Z',
  type: 'sample',
  data: { tps: 38, source: 'estimated', ts: '2026-11-20T18:39:00.000Z' },
};

test('the child journal reported usage becomes the task metrics', () => {
  const p = participantForTask(taskJson, `${JSON.stringify(childSample)}\n${JSON.stringify(childUsage)}\n`);
  assert.deepEqual(p, {
    taskId: 'mwpasz67-2-w828',
    agent: 'gentle-ai-explore',
    status: 'completed',
    childPath: '/home/x/.gentle-shell/agent/gentle-agents/sessions/20261120_abcd.jsonl',
    metrics: {
      tps: 41.5,
      source: 'reported',
      reported: { input: 900, output: 412, cacheRead: 10, cacheWrite: null },
      ts: '2026-11-20T18:40:00.000Z',
    },
  });
});

test('a child with no usage record relays explicit no-data', () => {
  const p = participantForTask(taskJson, `${JSON.stringify(childSample)}\n`);
  assert.equal(p.taskId, 'mwpasz67-2-w828');
  assert.equal(p.metrics, null);
  assert.equal(p.childPath, JSON.parse(taskJson).sessionPath);
});

test('the last usage record wins and junk never breaks the fold', () => {
  const late = { ...childUsage, ts: '2026-11-20T18:41:00.000Z' };
  late.data = { ...childUsage.data, tps: 52.25, reported: { ...childUsage.data.reported, output: 630 } };
  const body = [
    'not json',
    JSON.stringify(childUsage),
    `{"v":1,"producer":"pi-tokstream","type":"mystery"}`,
    JSON.stringify(late),
  ].join('\n');
  const p = participantForTask(taskJson, body);
  assert.equal(p.metrics.tps, 52.25);
  assert.equal(p.metrics.reported.output, 630);
});

test('a malformed task file yields nothing — never a guessed identity', () => {
  // A task whose child journal is unreadable still relays: “this task
  // finished and told us nothing” is explicit no-data, keyed by taskId.
  const silent = participantForTask(taskJson, null);
  assert.equal(silent.taskId, 'mwpasz67-2-w828');
  assert.equal(silent.metrics, null);
  assert.equal(participantForTask('{broken', JSON.stringify(childUsage)), null);
  assert.equal(participantForTask(JSON.stringify({ id: '' }), JSON.stringify(childUsage)), null);
});
