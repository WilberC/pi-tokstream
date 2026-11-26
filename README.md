# pi-tokstream

**Live tokens per second for your Pi session, recorded as data that other
tools can draw.** A producer-only [Pi](https://pi.dev) and
[Gentle Shell](https://github.com/Gentleman-Programming/gentle-shell) extension.

## What it does

While the main model streams, it estimates the output rate (tok/s); when each
message finalizes, it keeps the provider-reported throughput and usage (input,
output, cache read, cache write). Finished subagent tasks are relayed with
their own last reported usage. Everything goes into an append-only JSONL
journal beside the session file, size-rotated so it stays bounded. It renders
nothing: renderers such as the
[herdr-sidecar](https://github.com/WilberC/herdr-sidecar) agents view read the
journal and own all presentation.

## What it solves

- **Latency and cost you can see.** Throughput and token usage (including
  cache reads and writes) per message and per subagent are the raw numbers
  behind comparing models, spotting slow providers and checking whether
  prompt caching is actually hitting.
- **"Is the model actually streaming, and how fast?"** A side panel can show a
  live rate without hooking into Pi itself.
- **Invented numbers.** Estimates are labeled as estimates, provider numbers as
  reported, and a missing category is `null`, never zero.
- **Logs that grow forever.** The journal rotates at 2 MiB and keeps one
  previous generation.

## Install

```bash
# Gentle Shell
gentle-shell install npm:pi-tokstream

# Pi
pi install npm:pi-tokstream
```

Then `/reload` inside the session.

## Quick reference

| Command | Effect |
| --- | --- |
| `/tokstream` or `/tokstream status` | the switch plus the current snapshot (`n/a (no data)` before any measurement) |
| `/tokstream off` | stop all journal production until `/tokstream on` or a Pi restart (not persisted) |
| `/tokstream on` | resume production |

## Documentation

| I want to… | Read |
| --- | --- |
| Read the journal from a renderer | [docs/journal.md](https://github.com/WilberC/pi-tokstream/blob/main/docs/journal.md) |
| Know who owns what between producer and renderer | [docs/design.md](https://github.com/WilberC/pi-tokstream/blob/main/docs/design.md) |
| Run the tests | [docs/development.md](https://github.com/WilberC/pi-tokstream/blob/main/docs/development.md) |

## License

MIT — see [LICENSE](https://github.com/WilberC/pi-tokstream/blob/main/LICENSE).
