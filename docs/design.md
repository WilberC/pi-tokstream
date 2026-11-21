# Design boundaries

[Back to the README](../README.md)

- **Producer owns measurement**: estimated tok/s while streaming
  (`source: "estimated"`), provider-reported tok/s and usage after the message
  finalizes (`source: "reported"`). Missing categories are `null`, never zero.
  No throughput is invented without a measured window.
- **Renderer owns presentation**: where the numbers appear, formatting, icons,
  colors. It must present estimates as estimates and degrade explicitly when
  data is absent.
- Subagent correlation is out of scope for the basic version; the sampler
  covers the main model only.
- `/tokstream off` stops all journal production — no samples, no usage, no
  participant relays — until the next `/tokstream on` or a Pi restart. The
  switch is deliberately not persisted, so a forgotten `off` cannot leave
  renderers silently starved.

The journal format renderers rely on is in [journal.md](journal.md).
