# participant-relay

The parent's pi-tokstream relays each finished subagent's measured usage
into the parent journal, keyed by taskId, so renderers can show per-agent
TPS. Live per-agent TPS is impossible without a gentle-pi host change
(no surface reveals a child's taskId before it finishes); the user chose
the deferred join: reconcile with gentle-pi's own `tasks/<taskId>.json`,
persisted at task exit. Live estimates of the orchestrator are unchanged.

## Specs

S1 The user's choice, verbatim: "Ni agregando un paquete custom de pi es
solucionable? Sino lo es usemos la opcion que tiene delay no es lo mas
optimo, pero es aceptable porque sigue dando la info y no es fragil ni
hace trucos para obtaining la info".

S2 R7 acceptance (from the Obsidian note): TPS data must be the real data
of that process; a renderer without data degrades explicitly, never an
invented value. The relay copies the child's own `usage` records
(provider-reported, producer-resolved tps) verbatim as facts; it never
computes or averages anything itself, and a child with no usage record
relays an explicit `metrics: null`.

Sources (verified 2026-11-20 by explorer): children inherit installed
extensions (`PI_CODING_AGENT_DIR`), so pi-tokstream already runs in each
subagent; child journals sit beside their session files under
`<agentHome>/gentle-agents/sessions/`. The parent's bus event
`gentle-pi:notification:source` carries `{source:"subagent", taskId,
status, parentSessionId}` but only the PARENT session id. The task file
`<agentHome>/gentle-agents/tasks/<taskId>.json` records `sessionPath`,
agent name and status, written at task exit (`gentle-agents.ts`
persist call site ~:1646).

## Tasks

- T1, S1 S2: pure reconciliation — `lib/participants.mjs`:
  `participantForTask(taskJson, childJournalText)` returns the participant
  record data keyed by taskId from the task file and the child journal's
  last `usage` record; no usage → `metrics: null`. Tests without a host.
- T2, S1 S2: parent wiring in `index.ts` — subscribe to
  `gentle-pi:notification:source`, accept only `source:"subagent"` events
  with a terminal status of THIS session, resolve the task file from the
  agent dir (the sessions parent dir), read the child journal beside the
  child `sessionPath`, append ONE `participant` record per task
  (idempotent per taskId), skip entirely in children
  (`GENTLE_PI_AGENTS_CHILD === "1"`).

## Log

- L1 (2026-11-20, verbatim): "si" — approval to start T4 after the user
  chose the deferred join over a host patch.
- L2 (2026-11-20): explorer evidence: Pi core ships only an example
  subagent tool; the real runner is gentle-pi (`lib/agents-runner.ts`);
  no taskId reaches the child via argv/env/session file; `tasks/<taskId>.json`
  (with `sessionPath`) persists only at exit; the bus event exposes
  taskId+status but `sessionId: parentSessionId`.
