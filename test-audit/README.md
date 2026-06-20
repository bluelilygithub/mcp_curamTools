# Test audit log

This folder records **when tests were last run** on this machine. Files are auto-generated — do not edit by hand.

## View last run

```bash
npm run test:audit
# or
cat test-audit/LAST_RUN.md
```

## Files

| File | Purpose |
|------|---------|
| `LAST_RUN.md` | Human-readable summary of the most recent test command |
| `last-run.json` | Machine-readable record of the most recent run |
| `last-unit.json` | Most recent `npm run test:unit` only |
| `last-full.json` | Most recent `npm test` (unit + smoke) |
| `history.jsonl` | Append-only log (last 100 runs) |

## When files update

| Command | Audit suite | Updates |
|---------|-------------|---------|
| `npm run test:unit` | `unit` | `last-run`, `last-unit`, `LAST_RUN.md`, `history` |
| `npm test` | `full` | all above + `last-full` |

See `knowledge_base/core/TESTING.md` for what the tests cover.
