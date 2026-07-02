# Scoring methodology

Boswell health score is **0–1000**, computed deterministically in `src/lib/scoring/engine.ts`.

## Weights

| Dimension | Weight |
|-----------|--------|
| Security | 25% |
| Architecture | 20% |
| Maintainability | 15% |
| Dependencies | 10% |
| Testing | 10% |
| Documentation | 5% |
| Complexity | 5% |
| AI Slop | 5% |
| Release Risk | 5% |

## Rules

- LLMs **explain** scores; they never invent them.
- Each dimension starts at 1000 and deducts based on measurable signals (finding counts, file sizes, test coverage proxies, slop %).
- Snapshots stored in `score_snapshots` for trend charts.

## AI Slop Score

Separate percentage from `src/lib/slop/engine.ts` — pattern heuristics only. Always labeled as indicators, not proof.
