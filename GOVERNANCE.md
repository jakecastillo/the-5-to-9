# Governance

> Who decides, and how. Kept short on purpose — every line is context cost.

## Today: single maintainer

The 5 to 9 is currently a **single-maintainer** project. [@jakecastillo](https://github.com/jakecastillo)
is the floor manager: final call on scope, design, and what merges. This is the honest
state of an early-stage experiment, not a permanent structure.

## How decisions get made

- **Changes land via pull request** that greens the one gate that counts:
  `bash tests/validate-plugin.sh` exits 0. No green, no merge — including the
  maintainer's own work. See [CONTRIBUTING.md](CONTRIBUTING.md).
- **The roadmap is tracked in beads** (the project is partly self-hosting). Big
  direction calls get aired in [Discussions](https://github.com/jakecastillo/the-5-to-9/discussions)
  before they become beads.
- **The safety gate is not up for debate.** The irreversible-action hard gate is the
  project's core invariant; a change that weakens it doesn't merge.

## Becoming a maintainer

There's no formal ladder yet. The path is the obvious one: show up, land good PRs,
review others' work fairly, and care about the gate. When sustained contributors
appear, this document grows up with the project.

## Code of Conduct

Everyone here — maintainer included — is held to the
[Code of Conduct](CODE_OF_CONDUCT.md).
