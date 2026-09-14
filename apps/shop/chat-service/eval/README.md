# Shopping agent evals

A labelled dataset and a runner for the Metal Mart shopping agent — the
assistant that reads the support chat, works out what the customer wants, and
commits to a single action.

The point of interest is not the score. It is that the same command produces a
different score depending on what the agent is allowed to talk to, and only one
of those scores describes the shop.

## What is being evaluated

The shopping agent is a tool-calling loop (`src/agent/loop.ts`). Given one
customer message it may call any of four read tools — `search_products`,
`get_product`, `check_stock`, `get_order` — as many times as it needs, and must
finish by calling exactly one of three terminal tools:

| Terminal tool | Meaning |
| --- | --- |
| `place_order` | the customer's request can be filled |
| `offer_alternative` | it cannot, so something else is offered instead |
| `issue_refund` | the customer has a problem with an existing order |

The loop is hand-written rather than using an SDK tool runner, because scoring
needs to stop *at* the terminal call and inspect its arguments without executing
it. The label for a case is that call.

## The dataset

`dataset/shopping-agent-v1.jsonl` — one case per line:

```json
{
  "id": "case-0003",
  "input": "I'd like a Increase Velocity Sticker, please.",
  "expected": { "tool": "place_order",
                "args": { "items": [{ "productId": 5, "quantity": 1 }],
                          "total_cents": 499 } },
  "scoring": "exact",
  "tag": "exact-name"
}
```

Cases are generated deterministically from a catalogue (`dataset/generate.ts`),
grouped into classes that each probe one thing:

| Class | What it asks |
| --- | --- |
| `exact-name` | a product named exactly as the catalogue spells it |
| `fuzzy-name` | the same product named loosely, in lower case |
| `quantity-words` | "a couple of", "a pair of" — quantities written as words |
| `multi-item` | two products in one message, so the total has to be summed |
| `kind-missing` | a category the shop does not carry at all |
| `bulk-beyond-stock` | a conference-sized quantity nobody stocks |
| `budget-cheapest` | the cheapest item, overall or within a kind |
| `budget-ceiling` | the dearest item that still fits under a stated cap |
| `refund` | a problem with an order the customer already has |

Classes whose answer would be ambiguous in a given catalogue are skipped rather
than labelled arbitrarily — if two products tie on price, "the cheapest shirt"
has no single defensible answer, and the generator says so instead of picking
one.

`npm run eval:show` prints the whole suite readably, one example per class.

## Scoring

Three modes, declared per case, because not every case has the same kind of
right answer:

- **`exact`** — the tool and every argument must match. Used where there is one
  defensible answer: a computed order total, a specific order id.
- **`tool`** — only the tool must match. Used where the *action* is unambiguous
  but the argument is taste. "We don't sell mugs, offer something else" has many
  reasonable substitutes; scoring the substitute would measure preference.
- **`request`** — the tool plus `instead_of`, the request that could not be
  filled. Splits an `offer_alternative` case into the half with a right answer
  (what was unfillable) and the half without (what to offer instead), and scores
  only the first.

The judge (`judge.ts`) is plain code. There is no model grading a model: a case
passes when the agent's final call matches the label, item order and duplicate
lines are canonicalised first, and every failure reduces to a one-line reason
(`wrong-total`, `wrong-tool`, `no-decision`, …) that the report groups into a
failure-mode tally.

## Running it

```bash
npm run eval          # against whatever dependencies the environment provides
```

Dependency choice is not a flag. `src/agent/deps.ts` reads the environment:

- `INVENTORY_SERVICE_URL` and `ORDER_SERVICE_URL` set → the agent calls those
  services, and the run describes the shop they belong to.
- Neither set → the agent reads a frozen catalogue from `fixtures/`, and the run
  prints a banner saying the score describes the fixture.

That seam is the whole design. The command never changes; what it can reach
does. To point it at a running cluster without deploying anything or standing an
environment up, wrap it:

```bash
mirrord exec --config-file ../../../.mirrord/agent-evals.json -- npm run eval
```

Everything after `--` is byte-identical to the bare run. The process still
executes locally, but inherits the target deployment's environment and network,
so the service URLs arrive populated and resolve inside the cluster.

The run is read-only. It places no orders — `execute: false` stops at the
terminal call — takes no traffic from the target, and does not patch or restart
it. Many runs can go at once.

### Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--threshold` | `0.85` | pass mark; the process exits non-zero below it |
| `--concurrency` | `16` | cases in flight (`EVAL_CONCURRENCY` also works) |
| `--limit` | all | run a subset, spread evenly across classes |
| `--dataset` | `eval/dataset/shopping-agent-v1.jsonl` | which suite |
| `--out` | `eval/results/latest.json` | where full results are written |

`--limit` round-robins the classes rather than slicing, so a subset stays
representative — a plain slice would be entirely `exact-name`, the easiest class.

## Keeping the labels honest

A label is only as good as the catalogue it came from. A suite generated from a
snapshot will agree with that snapshot by construction, including everywhere the
snapshot has drifted from the shop — prices change, stock moves, and product
lines get added that the suite has never seen.

`npm run eval:refresh` re-derives the whole suite from the catalogue a running
cluster actually serves. It refuses to run without service URLs in the
environment, because deriving labels from the same frozen file it is meant to
replace would be worse than doing nothing:

```bash
mirrord exec --config-file ../../../.mirrord/agent-evals.json -- npm run eval:refresh
```

## In CI

`.github/workflows/ci-agent-evals.yml` runs the same command on a cold runner
with no environment of its own, gated on the threshold:

```yaml
mirrord ci start --config-file ../../../.mirrord/agent-evals.json -- \
  npm run eval -- \
    --limit "${{ github.event.inputs.limit || '36' }}" \
    --threshold "${{ github.event.inputs.threshold || '0.85' }}" \
    --out eval/results/mirrord.json
```

The report is written to the job summary, and the full per-case results land in
`eval/results/` as JSON.

## Layout

```
eval/
  dataset/
    generate.ts     builds cases from a catalogue, deterministically
    refresh.ts      regenerates from a live cluster
    shopping-agent-v1.jsonl
  fixtures/         frozen catalogue snapshots
  judge.ts          code-based scoring, no model in the loop
  report.ts         markdown scorecard and failure-mode tally
  run-eval.ts       the runner
  show.ts           prints the suite readably
  types.ts          case, result and summary shapes
```
