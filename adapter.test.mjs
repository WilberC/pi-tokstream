import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

test('journal contract matches pi-chat-recap line shape (2c)', async () => {
  const { JOURNAL_VERSION } = await import('./lib/journal.mjs');
  assert.equal(JOURNAL_VERSION, 1);
});
