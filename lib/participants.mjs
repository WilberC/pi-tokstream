// Participant reconciliation (odd/tasks/participant-relay.md): when a
// subagent task finishes, gentle-pi persists its TaskRecord (with the
// child's sessionPath) to <agentHome>/gentle-agents/tasks/<taskId>.json.
// The parent's pi-tokstream reads that file plus the child's journal beside
// the sessionPath and relays the child's own REPORTED usage into the parent
// journal as a participant record keyed by taskId. Pure relay: nothing is
// computed, averaged or correlated by guesswork; a child without a usage
// record produces metrics: null — explicit no-data, never a value.

import { parseJournal } from './journal.mjs';

// participantForTask folds one finished task's record and its child journal
// text into participant record data. taskJsonText is the TaskRecord file's
// body; childJournalText the child's pi-tokstream journal (or null). Both
// inputs are untrusted: malformed shapes yield null, never a guessed
// identity, because a record with a fabricated taskId would render as
// someone's data.
export function participantForTask(taskJsonText, childJournalText) {
  let task;
  try {
    task = JSON.parse(String(taskJsonText ?? ''));
  } catch {
    return null;
  }
  if (!task || typeof task.id !== 'string' || task.id === '' || typeof task.sessionPath !== 'string' || task.sessionPath === '') {
    return null;
  }
  const metrics = lastUsage(participantForTaskRecords(childJournalText));
  return {
    taskId: task.id,
    agent: typeof task.agent === 'string' ? task.agent : '',
    status: typeof task.status === 'string' ? task.status : '',
    childPath: task.sessionPath,
    metrics,
  };
}

// Records of the child journal that carry a usable reported usage. Samples
// are estimates and never relay as facts.
function participantForTaskRecords(childJournalText) {
  if (childJournalText == null) return [];
  return parseJournal(childJournalText).filter(
    (r) => r && r.type === 'usage' && r.data && r.data.tps != null && r.data.source === 'reported',
  );
}

function lastUsage(records) {
  if (records.length === 0) return null;
  const last = records[records.length - 1];
  return {
    tps: last.data.tps,
    source: last.data.source,
    reported: last.data.reported ?? null,
    ts: typeof last.ts === 'string' ? last.ts : null,
  };
}
