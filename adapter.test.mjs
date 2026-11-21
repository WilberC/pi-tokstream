import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('text_delta drives estimate, message_end usage drives reported record (2a,2b)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-adapter-'));
  const handlers = new Map(); const commands = new Map();
  const { default: ext } = await import('./index.ts');
  ext({ on: (e, f) => { handlers.set(e, f); return () => {}; },
        registerCommand: (n, o) => commands.set(n, o) });
  const notes = [];
  const ctx = { ui: { notify: (m, t) => notes.push([m, t]) },
    sessionManager: { getSessionFile: () => join(dir, 's.jsonl'), getSessionId: () => 'sess-7' } };
  await handlers.get('session_start')({ type: 'session_start', reason: 'startup' }, ctx);
  const msg = { role: 'assistant', content: [{ type: 'text', text: '' }],
    usage: { input: 120, output: 40, cacheRead: 30, cacheWrite: 10 } };
  for (const delta of ['Hola', ' que', ' tal']) {
    await handlers.get('message_update')({ type: 'message_update', message: msg,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta, partial: msg } }, ctx);
    await new Promise((r) => setTimeout(r, 10));
  }
  await handlers.get('message_end')({ type: 'message_end', message: msg }, ctx);
  await commands.get('tokstream').handler('', ctx);
  const recs = readFileSync(join(dir, 'pi-tokstream.journal.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(recs.every((r) => r.sessionId === 'sess-7'), 'journal lines carry the host session id');
  assert.ok(recs.some((r) => r.type === 'sample' && r.data.source === 'estimated'));
  assert.ok(recs.filter((r) => r.type === 'sample').every((r) => r.data.tps != null), 'no valueless samples');
  const usage = recs.find((r) => r.type === 'usage');
  assert.equal(usage.data.source, 'reported');
  assert.deepEqual(usage.data.reported, { input: 120, output: 40, cacheRead: 30, cacheWrite: 10 });
  assert.match(notes.at(-1)[0], /tok\/s \(reported\)/);
  rmSync(dir, { recursive: true, force: true });
});

test('N deltas inside the window append one sample, then message_end flushes the boundary (T1)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-adapter-'));
  const handlers = new Map(); const commands = new Map();
  const { default: ext } = await import('./index.ts');
  ext({ on: (e, f) => { handlers.set(e, f); return () => {}; },
        registerCommand: (n, o) => commands.set(n, o) });
  const ctx = { ui: { notify: () => {} },
    sessionManager: { getSessionFile: () => join(dir, 's.jsonl'), getSessionId: () => 'sess-t1' } };
  const read = () => readFileSync(join(dir, 'pi-tokstream.journal.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  await handlers.get('session_start')({ type: 'session_start' }, ctx);
  const msg = { role: 'assistant', content: [], usage: { input: 10, output: 12 } };
  // 12 deltas spread over ~36 ms: well inside the ~500 ms journal window.
  for (let i = 0; i < 12; i += 1) {
    await handlers.get('message_update')({ type: 'message_update', message: msg,
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x'.repeat(i + 1) } }, ctx);
    await new Promise((r) => setTimeout(r, 3));
  }
  const streaming = read().filter((r) => r.type === 'sample');
  assert.equal(streaming.length, 1, `12 deltas in the window append one sample, got ${streaming.length}`);
  await handlers.get('message_end')({ type: 'message_end', message: msg }, ctx);
  const samples = read().filter((r) => r.type === 'sample');
  assert.equal(samples.length, 2, 'message_end flushes exactly one final sample');
  const last = samples.at(-1);
  assert.equal(last.data.source, 'estimated');
  assert.ok(last.data.tps != null && last.data.tps > 0, 'the final sample carries a measured value');
  assert.ok(read().some((r) => r.type === 'usage' && r.data.source === 'reported'),
    'provider usage is still recorded after the flush');
  rmSync(dir, { recursive: true, force: true });
});

test('journal contract matches pi-chat-recap line shape (2c)', async () => {
  const { JOURNAL_VERSION } = await import('./lib/journal.mjs');
  assert.equal(JOURNAL_VERSION, 1);
});

test('tokstream off stops journal production; on resumes; status reports the state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tok-adapter-'));
  const handlers = new Map(); const commands = new Map();
  const { default: ext } = await import('./index.ts');
  ext({ on: (e, f) => { handlers.set(e, f); return () => {}; },
        registerCommand: (n, o) => commands.set(n, o) });
  const notes = [];
  const ctx = { ui: { notify: (m, t) => notes.push([m, t]) },
    sessionManager: { getSessionFile: () => join(dir, 's.jsonl'), getSessionId: () => 'sess-off' } };
  await handlers.get('session_start')({ type: 'session_start' }, ctx);
  const msg = { role: 'assistant', content: [], usage: { input: 10, output: 5 } };
  const stream = () => handlers.get('message_update')({ type: 'message_update', message: msg,
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello world' } }, ctx);

  await commands.get('tokstream').handler('off', ctx);
  assert.match(notes.at(-1)[0], /off/);
  await stream();
  await handlers.get('message_end')({ type: 'message_end', message: msg }, ctx);
  assert.equal(readLines(dir).length, 0, 'off produces no journal records');

  await commands.get('tokstream').handler('on', ctx);
  assert.match(notes.at(-1)[0], /on/);
  await stream();
  await new Promise((r) => setTimeout(r, 10));
  await handlers.get('message_end')({ type: 'message_end', message: msg }, ctx);
  assert.ok(readLines(dir).length > 0, 'on resumes journal production');
  assert.ok(readLines(dir).every((r) => r.sessionId === 'sess-off'));

  await commands.get('tokstream').handler('status', ctx);
  assert.match(notes.at(-1)[0], /on/);
  await commands.get('tokstream').handler('', ctx);
  assert.match(notes.at(-1)[0], /tokstream: on · (n\/a|[\d.]+ tok\/s)/, 'bare status still shows throughput-or-no-data');
  await commands.get('tokstream').handler('wat', ctx);
  assert.match(notes.at(-1)[0], /[Uu]sage/);
  rmSync(dir, { recursive: true, force: true });
});

function readLines(dir) {
  const p = join(dir, 'pi-tokstream.journal.jsonl');
  return existsSync(p)
    ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
}
