# The journal (for renderers)

[Back to the README](../README.md)

The extension appends an append-only JSONL journal next to the Pi session
file: `pi-tokstream.journal.jsonl`. Each record type is self-sufficient:

- `sample` — live estimate while streaming: `{tps, source:"estimated", ts}`.
  Writes are coalesced to at most one per ~500 ms, plus a final sample when the
  message or turn ends (the last sample always reflects the final state).
- `usage` — provider-reported data after the message finalizes:
  `{tps, source, reported:{input, output, cacheRead, cacheWrite}}`. Missing
  categories are `null`, never zero.
- `participant` — one per finished subagent task, written by the PARENT after
  gentle-pi persists the TaskRecord:
  `{taskId, agent, status, childPath, metrics}` where `metrics` is the child's
  own last reported usage (`{tps, source, reported, ts}`) or `null` when the
  child measured nothing. Relay only: the parent never computes throughput.

Consumers must tolerate unknown fields and unknown `type` values, must present
estimates as estimates, and must degrade explicitly when data is absent —
never compute throughput themselves.

## Rotation and bounded re-reads

The journal path is keyed by producer, so one file accumulates every session
written beside the same Pi session directory. To keep that bounded, the
producer rotates the file by size: when the live `pi-tokstream.journal.jsonl`
reaches 2 MiB (default, `createJournal({maxBytes})` overrides it; `0` disables
rotation) the next append renames it to `pi-tokstream.journal.jsonl.1` and
continues in a fresh file. One previous generation is kept (`keepRotated`);
older ones are replaced. The line format is identical in both files — only the
name changes — and rotation is checked at append time from a buffered byte
estimate, so the common append stays a single O(1) write.

Consumers keep working without changes: a byte-offset tail must already refold
from byte 0 when the file shrinks below its offset (the truncation rule), and a
rotated file always starts smaller than the offset the consumer reached on the
previous generation. So a session switch or a rotation costs at most one
bounded refold of the live file, never the whole history. Read the live file
only; `.1` exists to survive an in-flight read, not as a source of current
numbers.
