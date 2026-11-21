// Append-only JSONL journal (producer-only). One file per session, written
// next to the Pi session file; consumers (herdr-sidecar or any renderer)
// tail it and own all presentation. Line contract:
//   {v:1, producer, sessionId, ts, type, data}
// Consumers must tolerate unknown fields and unknown `type` values.
//
// The path is keyed by producer only, so one file accumulates every session
// written beside the same Pi session directory. It rotates by size: once the
// live file reaches `maxBytes` the next append renames it to `<file>.1` (one
// previous generation is kept) and writes into a fresh file. Consumers that
// tail by byte offset refold from 0 when the file shrinks below their offset,
// the same rule they already use for truncation.

import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const JOURNAL_VERSION = 1;

// Default live-file size limit (2 MiB). Small enough that a consumer refolds
// a bounded file on session switch; large enough that rotation is rare.
export const JOURNAL_MAX_BYTES = 2 * 1024 * 1024;

// Rotated generations kept beside the live file. One is enough to survive a
// rotation while a consumer is mid-read; older ones are replaced.
export const JOURNAL_ROTATED_FILES = 1;

export function journalPathFor(sessionFile, name) {
  return join(dirname(sessionFile), `${name}.journal.jsonl`);
}

export function createJournal({
  file,
  sessionId,
  producer,
  now = () => new Date().toISOString(),
  maxBytes = JOURNAL_MAX_BYTES,
  keepRotated = JOURNAL_ROTATED_FILES,
} = {}) {
  let open = false;
  let sid = sessionId;
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 0;
  const generations = Number.isFinite(keepRotated) && keepRotated > 0 ? Math.floor(keepRotated) : 0;
  // Best-known live-file size. Appends increment it, so the expensive stat()
  // only runs once the buffered total crosses the limit: the common append is
  // still one write and O(1), and the file can overshoot by at most one line.
  let size = 0;

  // rename generations: <file> -> <file>.1, shifting older ones out.
  let rotationWarned = false;
  const warnRotationFailure = (error) => {
    // One warning per process: rotation failing is a disk-level condition the
    // host cannot fix, so a single diagnostic preserves visibility without
    // turning a background journal into a log spam source.
    if (rotationWarned) return;
    rotationWarned = true;
    console.warn(`pi-tokstream: journal rotate failed (${error}); journal will keep growing until rotation succeeds`);
  };

  const rotate = () => {
    try {
      for (let i = generations; i > 1; i -= 1) {
        try {
          renameSync(`${file}.${i - 1}`, `${file}.${i}`);
        } catch {
          // No such generation yet; nothing to shift.
        }
      }
      renameSync(file, `${file}.1`);
    } catch (error) {
      // Rotation is best effort: a failed rename leaves the journal where it
      // is (the pre-rotation behavior) instead of breaking the host session.
      // Signal it once so unbounded growth is not silent (P3).
      warnRotationFailure(error);
    }
    size = 0;
  };

  const write = (type, data) => {
    if (!file || !open) return null;
    const line = JSON.stringify({
      v: JOURNAL_VERSION,
      producer,
      sessionId: sid,
      ts: now(),
      type,
      data,
    });
    try {
      mkdirSync(dirname(file), { recursive: true });
      if (limit > 0 && size >= limit) {
        let actual = 0;
        try {
          actual = statSync(file).size;
        } catch {
          actual = 0; // No live file yet: nothing to rotate.
        }
        if (actual >= limit) rotate();
        else size = actual;
      }
      const bytes = Buffer.byteLength(line, 'utf8') + 1;
      appendFileSync(file, `${line}\n`, 'utf8');
      size += bytes;
      return line;
    } catch {
      // A journaling failure never breaks the host session; consumers
      // degrade explicitly when data is absent.
      return null;
    }
  };

  return {
    // Bind (or rebind) to a session file; call again on session switch.
    // An explicit sessionId updates the recorded id (advisory: the id comes
    // from the host at session_start, not at extension load).
    openSession(sessionFile, sessionId) {
      if (!sessionFile) {
        open = false;
        return null;
      }
      if (typeof sessionId === 'string' && sessionId !== '') sid = sessionId;
      file = journalPathFor(sessionFile, producer);
      open = true;
      // One stat per session switch seeds the buffered size, so a journal
      // carried over from earlier sessions (already oversized) rotates on the
      // very next append instead of after another whole limit of writes.
      size = 0;
      if (limit > 0) {
        try {
          size = statSync(file).size;
        } catch {
          size = 0; // No journal yet: the first append creates it.
        }
      }
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
