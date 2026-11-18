# LaunchScope — a token launch radar

An entry to make.fun's **best token launch radar** bounty
([token-radar-01](https://make.fun/bounty/token-radar-01)), built by **@qtz**.

LaunchScope reads the sealed DefiLlama snapshot (758 protocols, fetched
2026-11-14), finds every protocol that still records no token and is not a
wrapped, staked or bridged product of one that trades, and ranks them by
implied launch value. The whole watchlist is on the board — and so is every
other qualifying protocol down to the snapshot's $5M TVL cut.

## The model

```
implied = TVL x category multiple x momentum x maturity x breadth
```

- **Category multiple** — the median market-cap / TVL ratio of the
  token-bearing protocols in the same DefiLlama category, computed from the
  snapshot itself (categories with fewer than 4 comps use the all-category
  median). Lending markets are priced like lending markets trade.
- **Momentum** — the 7-day TVL change, clamped to [-30%, +50%] and scaled.
- **Maturity** — years tracked with no token recorded; large, old and
  token-free is the classic launch profile.
- **Breadth** — 2% per extra chain, capped at ten.

No protocol name is special-cased: the same code scores every row and writes
every farm plan (five concrete steps with costs and durations, generated from
the protocol's category, chains and size).

## The dashboard

A static page (no network, no framework): a sortable, filterable board with
search, category / chain / minimum-TVL filters and a watchlist toggle; a
detail view per protocol showing its four value factors and its farm plan;
and an "Already launched" view that keeps token-bearing protocols apart at
the market's own values — they are the comparables, never ranked.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. Writes `board.json`, `data.js`,
`dashboard/`, `screenshots/` and `dossier.json` to the output directory.

---

Built for the [make.fun token-radar-01 bounty](https://make.fun/bounty/token-radar-01).
Try make.fun with referral code **cxst033q**.
