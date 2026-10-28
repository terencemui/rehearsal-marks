## Agent skills

### Issue tracker

Issues live as GitHub issues in this repo, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles map to themselves: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/`. See `docs/agents/domain.md`.

### Prototypes

Throwaway design explorations are kept on their own branches as primary sources, and are never merged to main. They are not stale branches — never delete one in a branch cleanup. See `docs/prototypes.md`.

### Browser verification

Driving Claude in Chrome to test or verify a change (screenshots, clicking through a flow, reading console/network output) burns a lot of context in the main session. Spawn a subagent to do the Claude-in-Chrome work and report its findings back, rather than driving the browser inline.
