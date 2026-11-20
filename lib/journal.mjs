// Append-only JSONL journal (producer-only). One file per session, written
// next to the Pi session file; consumers (herdr-sidecar or any renderer)
// tail it and own all presentation. Line contract:
//   {v:1, producer, sessionId, ts, type, data}
// Consumers must tolerate unknown fields and unknown `type` values.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const JOURNAL_VERSION = 1;

export function journalPathFor(sessionFile, name) {
  return join(dirname(sessionFile), `${name}.journal.jsonl`);
}

export function createJournal({ file, sessionId, producer, now = () => new Date().toISOString() } = {}) {
  let open = false;

  const write = (type, data) => {
    if (!file || !open) return null;
    const line = JSON.stringify({
      v: JOURNAL_VERSION,
      producer,
      sessionId,
      ts: now(),
      type,
      data,
    });
    try {
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(file, `${line}\n`, 'utf8');
      return line;
    } catch {
      // A journaling failure never breaks the host session; consumers
      // degrade explicitly when data is absent.
      return null;
    }
  };

  return {
    // Bind (or rebind) to a session file; call again on session switch.
    openSession(sessionFile) {
      if (!sessionFile) {
        open = false;
        return null;
      }
      file = journalPathFor(sessionFile, producer);
      open = true;
      return file;
    },

    close() {
      open = false;
    },

    isOpen() {
      return open;
    },

    target() {
      return open ? file : null;
    },

    append: write,
  };
}

// Parse a journal file's lines; skips blank and malformed lines so a torn
// tail write never breaks consumers.
export function parseJournal(text) {
  const records = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      records.push(JSON.parse(trimmed));
    } catch {
      // Skip malformed line; keep the rest.
    }
  }
  return records;
}
