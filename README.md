# pi-tokstream

Producer-only token throughput data for [Pi](https://pi.dev) and
[Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell).

The extension measures the main model's output rate while streaming and keeps
the provider-reported usage of each finalized message, and renders nothing.
Renderers (for example the herdr-sidecar agents view) consume snapshots and
own all presentation.

## Install

```bash
pi install npm:pi-tokstream
```

## Design boundaries

- **Producer owns measurement**: estimated tok/s while streaming
  (`source: "estimated"`), provider-reported tok/s and usage after the
  message finalizes (`source: "reported"`). Missing categories are `null`,
  never zero. No throughput is invented without a measured window.
- **Renderer owns presentation**: where the numbers appear, formatting,
  icons, colors. It must present estimates as estimates and degrade
  explicitly when data is absent.
- Subagent correlation is out of scope for the basic version; the sampler
  covers the main model only.

## Journal (for renderers)

The extension appends an append-only JSONL journal next to the Pi session
file: `pi-tokstream.journal.jsonl`. Two record types, each self-sufficient:

- `sample` — throttled live estimate while streaming: `{tps, source:"estimated", ts}`.
- `usage` — provider-reported data after the message finalizes: `{tps, source, reported:{input, output, cacheRead, cacheWrite}}`. Missing categories are `null`, never zero.

Consumers must tolerate unknown fields and unknown `type` values, must
present estimates as estimates, and must degrade explicitly when data is
absent — never compute throughput themselves.

## Development

```bash
npm test
```

Core logic lives in `lib/sampler.mjs` and is tested without a Pi host
(`lib/sampler.test.mjs`).
