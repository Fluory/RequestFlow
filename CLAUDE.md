# CLAUDE.md – RequestFlow

@AGENTS.md

The imported project card (AGENTS.md) is binding – for every agent, not only Claude.
The `@AGENTS.md` import is mandatory: Claude Code does not read AGENTS.md on its own.

## Claude Code

- Load context in stages; never read whole directories or history; delegate mass reading to read-only scouts.
- Open a draft PR early and push. Finish a session with `/finish-work`: verify + `scripts/doku-check.sh`, plain-language section in the PR, handover comment when handing off, remove the worktree.
- The guards in `.claude/settings.json` (session-start card, push guard on `main`, stop check) are part of the system: on a false alarm open an issue in the control center, never disable or bypass a hook.
- Area rules live in `.claude/rules/` and load only when you read matching files; do not copy them here.

# Compact instructions

When compacting, preserve: the goal and non-goals of the current issue; the affected files and interfaces; the current diff state (committed vs. uncommitted); the last test and verify command with its result; open risks, assumptions, the open hypothesis and the next smallest step. Drop exploration output, tool logs and superseded attempts. The rules come back through AGENTS.md and the session card.
