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
