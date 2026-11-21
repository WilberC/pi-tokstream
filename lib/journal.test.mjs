import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createJournal, journalPathFor, parseJournal, JOURNAL_VERSION } from './journal.mjs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

test('journal appends contract lines next to the session file', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const sessionFile = join(dir, 'session-a.jsonl');
  const j = createJournal({ file: '', sessionId: 's1', producer: 'pi-tokstream' });
  const target = j.openSession(sessionFile);
  assert.equal(target, join(dir, 'pi-tokstream.journal.jsonl'));
  const line = j.append('exchange', { id: 1, status: 'aborted' });
  const parsed = JSON.parse(line);
  assert.equal(parsed.v, JOURNAL_VERSION);
  assert.equal(parsed.producer, 'pi-tokstream');
  assert.equal(parsed.sessionId, 's1');
  assert.equal(parsed.type, 'exchange');
  assert.deepEqual(parsed.data, { id: 1, status: 'aborted' });
  assert.equal(typeof parsed.ts, 'string');
  assert.equal(parseJournal(readFileSync(target, 'utf8')).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('append before openSession is a no-op; close stops writes', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const j = createJournal({ file: join(dir, 'x.jsonl'), sessionId: 's1', producer: 'p' });
  assert.equal(j.append('t', {}), null);
  j.openSession(join(dir, 'session.jsonl'));
  assert.equal(j.isOpen(), true);
  j.close();
  assert.equal(j.append('t', {}), null);
  assert.equal(j.target(), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rebinding to a new session switches the file', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const j = createJournal({ file: '', sessionId: 's1', producer: 'p' });
  j.openSession(join(dir, 'a.jsonl'));
  j.openSession(join(dir, 'b.jsonl'));
  j.append('t', { n: 1 });
  assert.equal(readFileSync(join(dir, 'p.journal.jsonl'), 'utf8').split('\n').filter(Boolean).length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('parseJournal tolerates blank and torn lines', () => {
  const records = parseJournal('{"a":1}\n\n{broken\n{"a":2}\n');
  assert.deepEqual(records.map((r) => r.a), [1, 2]);
  assert.equal(parseJournal('').length, 0);
  assert.equal(journalPathFor('/s/x/session.jsonl', 'pi-tokstream'), '/s/x/pi-tokstream.journal.jsonl');
});

// T7/F2: the producer-keyed journal accumulates every session written beside
// the same Pi session directory. Rotation by size keeps the live file bounded
// (and therefore the bytes a byte-offset consumer refolds on session switch)
// while preserving the format and the most recent generation.

const sampleLine = (pad, seq) =>
  JSON.stringify({
    v: JOURNAL_VERSION,
    producer: 'p',
    sessionId: 's1',
    ts: '2026-01-01T00:00:00.000Z',
    type: 'sample',
    data: { tps: 1, source: 'estimated', seq, pad },
  });

test('an oversized journal rotates on append, keeps one sibling, live file stays bounded (T7/F2)', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const sessionFile = join(dir, 'session.jsonl');
  const MAX = 400;
  const j = createJournal({ file: '', sessionId: 's1', producer: 'p', maxBytes: MAX });
  const target = j.openSession(sessionFile);
  // ~293 bytes per line: one line fits, two cross the limit, so every second
  // append rotates and the live file never exceeds it.
  for (let seq = 1; seq <= 7; seq += 1) j.append('sample', { tps: 1, source: 'estimated', seq, pad: 'x'.repeat(150) });

  assert.ok(fs.statSync(target).size < MAX, 'live journal stays under the limit');
  assert.ok(fs.statSync(`${target}.1`).size >= MAX, 'the oversized generation is kept as .1');
  assert.equal(fs.existsSync(`${target}.2`), false, 'only one rotated generation is kept');

  const live = parseJournal(readFileSync(target, 'utf8'));
  const rotated = parseJournal(readFileSync(`${target}.1`, 'utf8'));
  assert.deepEqual(live.map((r) => r.data.seq), [7]);
  assert.ok(rotated.length >= 2);
  // Continuity across the rename: no record lost, none duplicated.
  assert.equal(rotated.at(-1).data.seq + 1, live[0].data.seq);
  // The line format is untouched by rotation.
  assert.equal(rotated[0].v, JOURNAL_VERSION);
  assert.equal(rotated[0].producer, 'p');
  assert.equal(rotated[0].type, 'sample');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a journal carried over from a previous session rotates on the first append (T7/F2)', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const sessionFile = join(dir, 'session.jsonl');
  const target = journalPathFor(sessionFile, 'p');
  fs.writeFileSync(
    target,
    Array.from({ length: 20 }, (_, seq) => sampleLine('x'.repeat(50), seq)).join('\n') + '\n',
  );
  const before = fs.statSync(target).size;
  const MAX = 400;
  assert.ok(before >= MAX);

  const j = createJournal({ file: '', sessionId: 's2', producer: 'p', maxBytes: MAX });
  j.openSession(sessionFile);
  j.append('sample', { tps: 1, source: 'estimated', seq: 'fresh' });

  assert.equal(fs.statSync(`${target}.1`).size, before, 'the whole old history moves to .1');
  const live = parseJournal(readFileSync(target, 'utf8'));
  assert.equal(live.length, 1, 'the new session starts in a fresh file');
  assert.equal(live[0].sessionId, 's2');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rotation leaves the live file smaller than the consumer offset, so a byte-offset tail refolds (S4)', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const sessionFile = join(dir, 'session.jsonl');
  const MAX = 400;
  const j = createJournal({ file: '', sessionId: 's1', producer: 'p', maxBytes: MAX });
  const target = j.openSession(sessionFile);
  // Consumer already folded these bytes (its offset equals the file size).
  for (let seq = 1; seq <= 2; seq += 1) j.append('sample', { tps: 1, source: 'estimated', seq, pad: 'x'.repeat(150) });
  const consumerOffset = fs.statSync(target).size;
  assert.ok(consumerOffset >= MAX);

  j.append('sample', { tps: 1, source: 'estimated', seq: 3, pad: 'x'.repeat(150) });
  // The fresh generation is smaller than what the consumer consumed: its
  // shrink rule (size < offset) resets the read position to byte 0.
  const fresh = fs.existsSync(target) ? fs.statSync(target).size : 0;
  assert.ok(fresh < consumerOffset, 'fresh file shrinks below the consumed offset');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a journal under the limit never rotates; maxBytes 0 disables rotation (T7/F2)', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'recap-journal-'));
  const sessionFile = join(dir, 'session.jsonl');

  const plain = createJournal({ file: '', sessionId: 's1', producer: 'p' });
  const plainTarget = plain.openSession(sessionFile);
  for (let seq = 1; seq <= 3; seq += 1) plain.append('sample', { tps: 1, source: 'estimated', seq });
  assert.equal(fs.existsSync(`${plainTarget}.1`), false, 'the default limit leaves small journals alone');

  const unlimited = createJournal({ file: '', sessionId: 's1', producer: 'p', maxBytes: 0 });
  const target = unlimited.openSession(sessionFile);
  for (let seq = 1; seq <= 5; seq += 1) {
    unlimited.append('sample', { tps: 1, source: 'estimated', seq, pad: 'x'.repeat(150) });
  }
  assert.equal(fs.existsSync(`${target}.1`), false, 'maxBytes 0 means rotate never');
  assert.equal(parseJournal(readFileSync(target, 'utf8')).length, 8);
  fs.rmSync(dir, { recursive: true, force: true });
});
