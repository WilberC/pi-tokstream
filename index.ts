import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createSampler, createSampleThrottle } from './lib/sampler.mjs';
import { createJournal } from './lib/journal.mjs';
import { participantForTask } from './lib/participants.mjs';

// pi-tokstream: producer-only throughput data. Measures the main model's
// output rate while streaming and keeps provider-reported usage per message.
// Renders nothing: renderers (herdr-sidecar, Gentle Shell panels) consume
// snapshots and own all presentation. Estimates are always labeled as such.
//
// Subagent participants (odd/tasks/participant-relay.md): when gentle-agents
// finishes a subagent task, its TaskRecord (with the child sessionPath) is
// persisted at <agentHome>/gentle-agents/tasks/<taskId>.json; the parent
// here relays the child's own reported usage into this journal as one
// `participant` record keyed by taskId. Pure relay: nothing is computed,
// and a task that measured nothing relays metrics: null — never a guess.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out']);
const relayedTasks = new Set<string>();

// taskFilePath maps a taskId to gentle-agents' TaskRecord file under the
// agent home derived from our session file (everything before /sessions/).
// An unlocatable path simply means no record: the parent journal lives where
// the user's session lives, outside gentle-agents' own tree.
const taskFilePath = (sessionFile: string | null, taskId: string): string => {
  if (!sessionFile) return '';
  const i = sessionFile.lastIndexOf('/sessions/');
  if (i < 0) return '';
  return join(sessionFile.slice(0, i), 'gentle-agents', 'tasks', `${taskId}.json`);
};

// relayParticipant reads the finished task's record and child journal and
// appends one participant record to OUR journal. One record per taskId, ever.
const relayParticipant = (
  journal: ReturnType<typeof createJournal>,
  sessionFile: string | null,
  taskId: string,
) => {
  if (relayedTasks.has(taskId)) return;
  relayedTasks.add(taskId);
  const taskFile = taskFilePath(sessionFile, taskId);
  if (!taskFile) return;
  let taskJsonText: string | null = null;
  let childJournalText: string | null = null;
  try {
    taskJsonText = readFileSync(taskFile, 'utf8');
  } catch {
    // No persisted record: nothing to relay from.
    return;
  }
  let childSessionPath = '';
  try {
    childSessionPath = (JSON.parse(taskJsonText) as { sessionPath?: string }).sessionPath ?? '';
  } catch {
    return;
  }
  if (childSessionPath) {
    try {
      childJournalText = readFileSync(join(dirname(childSessionPath), 'pi-tokstream.journal.jsonl'), 'utf8');
    } catch {
      childJournalText = null; // relay the task anyway, with explicit no-data
    }
  }
  const p = participantForTask(taskJsonText, childJournalText);
  if (p) journal.append('participant', p);
};

export default function tokstream(pi: ExtensionAPI) {
  const sampler = createSampler();
  const sampleThrottle = createSampleThrottle();
  const journal = createJournal({ sessionId: '', producer: 'pi-tokstream' });
  const isChild = process.env.GENTLE_PI_AGENTS_CHILD === '1';
  let currentSessionId = '';
  let currentSessionFile: string | null = null;

  const appendSample = (tps: number, source: string | null) => {
    journal.append('sample', { tps, source, ts: new Date().toISOString() });
  };

  // Final live sample before the stream's estimate is replaced by reported
  // usage (message_end) or a turn ends. The throttle guarantees this write
  // whenever deltas arrived after the last one, so the last sample reflects
  // the final state instead of the last interval boundary.
  const flushSample = () => {
    const tps = sampleThrottle.flush();
    if (tps != null) appendSample(tps, 'estimated');
  };

  const countTextDeltas = (event: unknown): number => {
    const e = event as { assistantMessageEvent?: { type?: string; delta?: string } };
    return e?.assistantMessageEvent?.type === 'text_delta'
      ? Math.max(1, Math.ceil((e.assistantMessageEvent.delta ?? '').length / 4))
      : 0;
  };

  pi.on('session_start', async (_event, ctx) => {
    currentSessionFile = ctx.sessionManager?.getSessionFile?.() ?? null;
    journal.openSession(
      currentSessionFile,
      ctx.sessionManager?.getSessionId?.(),
    );
    sampleThrottle.reset();
    currentSessionId = ctx.sessionManager?.getSessionId?.() ?? '';
  });
  pi.on('session_shutdown', () => journal.close());

  // Participant relay: parents only — a child measuring its own session
  // never relays (its records land in its own journal and are relayed by
  // its parent once it finishes).
  if (!isChild) {
    pi.events?.on?.('gentle-pi:notification:source', (raw: unknown) => {
      const e = raw as {
        source?: string;
        event?: string;
        taskId?: string;
        parentSessionId?: string;
      };
      if (e?.source !== 'subagent' || typeof e.taskId !== 'string' || e.taskId === '') return;
      if (!e.event || !TERMINAL_STATUSES.has(e.event.slice('subagent.'.length))) return;
      if (e.parentSessionId && currentSessionId && e.parentSessionId !== currentSessionId) return;
      relayParticipant(journal, currentSessionFile, e.taskId);
    });
  }

  pi.on('message_update', async (event) => {
    const count = countTextDeltas(event);
    if (count > 0) {
      sampler.delta(count);
      const snap = sampler.snapshot();
      if (snap.active && snap.tps != null) {
        // Journal writes are throttled to one per ~500 ms while streaming:
        // a sync append per token blocks Pi's echo loop. Only measured values
        // are written; consumers render the last value, and the final state
        // is flushed when the message or turn ends.
        if (sampleThrottle.offer(snap.tps)) appendSample(snap.tps, snap.source);
      }
    }
  });

  pi.on('turn_end', async () => {
    flushSample();
  });

  pi.on('message_end', async (event) => {
    // Flush the live estimate before usage() ends the measured window, so the
    // last streaming sample still reflects the final token count.
    flushSample();
    const message = (event as { message?: unknown }).message as
      | { role?: string; usage?: Record<string, number> }
      | undefined;
    if (message?.role === 'assistant' && message.usage) {
      const r = sampler.usage(message.usage);
      journal.append('usage', {
        tps: r.reportedTps,
        source: r.reportedTps != null ? 'reported' : null,
        reported: r.reported,
      });
    }
  });

  pi.registerCommand('tokstream', {
    description: 'Token throughput data: current snapshot status',
    handler: async (_args, ctx) => {
      const s = sampler.snapshot();
      const tps = s.tps != null ? `${s.tps.toFixed(1)} tok/s` : 'n/a';
      ctx.ui.notify(
        `tokstream: ${tps} (${s.source ?? 'no data'})`,
        'info',
      );
    },
  });
}
