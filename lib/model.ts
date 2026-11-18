// LaunchScope model: one sealed DefiLlama snapshot in, one ranked pre-token board out.
//
// The board ranks every protocol that records no token yet (no CoinGecko id, no symbol) and is not a
// wrapped, staked or bridged product of a token that already trades. The snapshot's watchlist is the
// floor: all 40 of its protocols are on the board, and so is every other qualifying protocol the
// snapshot carries, down to the $5M TVL cut of the snapshot itself. Protocols whose token already
// trades are never ranked here; the dashboard shows them apart, at the market's own values.
//
// The implied value is a comparable-companies estimate built only from the snapshot's own figures:
//
//   implied = TVL x category multiple x momentum x maturity x breadth
//
// - category multiple: the median market-cap / TVL ratio of the token-bearing protocols in the same
//   DefiLlama category, computed from this snapshot (categories with fewer than 4 comps fall back to
//   the all-category median). A lending market is priced like lending markets actually trade, not
//   like a DEX. The multiple is clamped to [0.05, 3.0] so one thin category cannot explode a row.
// - momentum: the 7-day TVL change, clamped to [-30, +50] percent, scaled by 0.6: a protocol gaining
//   users this week is worth more at launch than one bleeding TVL; a collapsing one is discounted,
//   never zeroed. Missing change data is neutral.
// - maturity: how long DefiLlama has tracked the protocol with no token recorded. The factor rises
//   from 0.80 for a brand-new listing to 1.15 at three years: a large protocol that has run for
//   years without a token is the classic launch candidate. Unknown listing date scores 0.92.
// - breadth: 2 percent per extra chain beyond the first, capped at ten: a protocol already deployed
//   across many chains launches to a wider holder base.
//
// No protocol name is ever special-cased; the same functions score and write the farm plan of every
// row, from the snapshot's fields alone.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One board row, as board.json carries it and the dashboard renders it. */
export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/** A board row with everything the dashboard's detail view shows about how it was scored. */
export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number | null;
  watchlist: boolean;
  multiple: number;
  comps: number;
  momentum: number;
  maturity: number;
  breadth: number;
  signals: string[];
}

/** A protocol whose token already trades, shown apart from the ranked board. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

/** Everything the dashboard renders. */
export interface Radar {
  as_of: string;
  floor_usd: number;
  scanned: number;
  pre_token: number;
  live_size: number;
  total_implied_usd: number;
  multiples: { category: string; multiple: number; comps: number }[];
  global_multiple: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export const MODEL_VERSION = 'launchscope-2';

/** Categories that are products of another protocol's token, never a launch of their own. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Exchange names a wrapped product may begin with (the watchlist rule's own list). */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Parse and lightly validate the sealed snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const snap = JSON.parse(text) as Snapshot;
  if (!Array.isArray(snap.protocols) || !Array.isArray(snap.watchlist)) {
    throw new Error('snapshot is missing its protocols or watchlist arrays');
  }
  return snap;
}

/** True when the snapshot records no token for the protocol. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/**
 * True when the protocol is a wrapped, staked or bridged product of a token that already trades,
 * judged by the same tests the watchlist rule states: a derivative category, a version suffix on
 * the name, a whole word wrapped/staked/staking, or an exchange's name at the front.
 */
export function isDerivativeProduct(p: SnapshotProtocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (/\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/.test(p.name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((x) => p.name === x || p.name.startsWith(`${x} `));
}

/** Whole days between the protocol's listing day and the snapshot's as_of day, or null. */
export function ageDays(p: SnapshotProtocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const days = (Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 ? Math.floor(days) : null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The comparable set: every token-bearing protocol's market-cap / TVL ratio, grouped by category. */
export function categoryMultiples(snapshot: Snapshot): {
  byCategory: Map<string, { multiple: number; comps: number }>;
  global: number;
} {
  const ratios = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const list = ratios.get(key) ?? [];
    list.push(ratio);
    ratios.set(key, list);
  }
  const global = clamp(median(all), 0.05, 3);
  const byCategory = new Map<string, { multiple: number; comps: number }>();
  for (const [category, list] of ratios) {
    byCategory.set(category, {
      multiple: list.length >= 4 ? clamp(median(list), 0.05, 3) : global,
      comps: list.length,
    });
  }
  return { byCategory, global };
}

/** The four factors of one protocol's implied value, each named so the dashboard can show them. */
export function scoreFactors(
  p: SnapshotProtocol,
  multiples: { byCategory: Map<string, { multiple: number; comps: number }>; global: number },
  asOf: string,
): { multiple: number; comps: number; momentum: number; maturity: number; breadth: number } {
  const entry = multiples.byCategory.get(p.category ?? 'Uncategorized');
  const multiple = entry?.multiple ?? multiples.global;
  const comps = entry?.comps ?? 0;
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, -30, 50);
  const momentum = 1 + (change / 100) * 0.6;
  const age = ageDays(p, asOf);
  const maturity = age === null ? 0.92 : 0.8 + 0.35 * Math.min(1, age / 1095);
  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 10);
  return { multiple, comps, momentum, maturity, breadth };
}

/** Short reader-facing signals derived from the row's own figures. */
function signalsOf(p: SnapshotProtocol, age: number | null, watchlist: boolean): string[] {
  const signals: string[] = [];
  if (watchlist) signals.push('Watchlist: TVL above the $50M floor');
  if (p.change_7d !== null && p.change_7d >= 10) signals.push(`TVL surging ${p.change_7d.toFixed(1)}% in 7 days`);
  else if (p.change_7d !== null && p.change_7d <= -10) signals.push(`TVL sliding ${p.change_7d.toFixed(1)}% in 7 days`);
  if (age !== null && age >= 1095) signals.push(`Token-free for ${(age / 365).toFixed(1)} years`);
  if (p.chains.length >= 8) signals.push(`Live on ${p.chains.length} chains`);
  if (p.tvl_usd >= 1_000_000_000) signals.push('Billion-dollar TVL, still no token recorded');
  return signals;
}

/** Suggested farming capital for a protocol of this size, in whole dollars. */
function capitalTier(tvl: number): { low: number; high: number; label: string } {
  if (tvl >= 500_000_000) return { low: 1000, high: 5000, label: 'institutional-scale' };
  if (tvl >= 100_000_000) return { low: 500, high: 2000, label: 'large' };
  if (tvl >= 25_000_000) return { low: 250, high: 1000, label: 'mid-size' };
  return { low: 100, high: 500, label: 'early-stage' };
}

const L2_CHAINS = new Set([
  'Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Zora',
  'Polygon', 'Polygon zkEVM', 'Avalanche', 'BSC', 'Solana', 'Sui', 'Aptos', 'Near', 'Fantom', 'Gnosis',
]);

/** The per-action cost a farmer actually pays, from the chains the protocol runs on. */
function gasProfile(p: SnapshotProtocol): { main: string; cheap: string | null } {
  const cheap = p.chains.find((c) => L2_CHAINS.has(c)) ?? null;
  return {
    main: 'Ethereum mainnet gas of roughly $8-25 per transaction at typical fees',
    cheap: cheap === null ? null : `${cheap}, where the same action costs under $0.50`,
  };
}

/** The core product action for a category: what farming this kind of protocol actually means. */
function coreAction(category: string | null): { verb: string; detail: string } {
  switch (category) {
    case 'Dexs':
      return { verb: 'trade and provide liquidity', detail: 'route weekly swaps through its pools and keep a two-sided liquidity position in its busiest pair' };
    case 'Lending':
      return { verb: 'supply and borrow', detail: 'supply a blue-chip collateral asset, borrow a stablecoin against it at under 50% loan-to-value, and recycle part of the borrow into a second supply position' };
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return { verb: 'allocate into its curated vaults', detail: 'deposit into two or three of its highest-TVL curated vaults rather than one, so your allocation history spans the curator\'s whole product line' };
    case 'CDP':
      return { verb: 'mint against collateral', detail: 'lock collateral in a vault, mint its stablecoin at a conservative collateral ratio above 180%, and hold or deploy the minted stablecoin inside the same ecosystem' };
    case 'RWA':
      return { verb: 'subscribe to a tokenized real-world asset', detail: 'complete its KYC once, subscribe to its flagship yield-bearing asset, and hold the position through at least one full distribution cycle' };
    case 'Yield':
    case 'Yield Aggregator':
      return { verb: 'deposit into its yield vaults', detail: 'deposit a stablecoin or ETH position into its main vault and let it compound untouched, harvesting only when a claim costs less than the reward' };
    case 'Perps':
    case 'Derivatives':
      return { verb: 'trade its perpetuals', detail: 'open small, hedged perpetual positions each week to build genuine volume history rather than one large wash-like burst' };
    case 'Chain':
      return { verb: 'be an active citizen of the chain', detail: 'bridge funds in, hold a balance on the chain itself, and use two or three of its native applications every week' };
    case 'Launchpad':
      return { verb: 'join its launches', detail: 'stake or hold its required access asset if it names one, and take a small allocation in at least two launches rather than chasing one' };
    case 'Payments':
      return { verb: 'route real payments through it', detail: 'move a recurring real payment or payroll through the protocol monthly so the history reads as usage, not farming theatre' };
    case 'Gaming':
      return { verb: 'play and hold its in-game assets', detail: 'play weekly sessions and hold earned in-game assets in the connected wallet instead of selling them off' };
    default:
      return { verb: 'use its core product', detail: 'use the protocol\'s main product the way a real user would, on a weekly rhythm, and keep the position or history in one wallet' };
  }
}

/**
 * The farm plan of one row: five concrete steps written from the protocol's own category, chains
 * and size, each carrying what it costs and how long it takes. Every step lands between 20 and 600
 * characters, as the gate requires.
 */
export function farmSteps(p: SnapshotProtocol): string[] {
  const tier = capitalTier(p.tvl_usd);
  const gas = gasProfile(p);
  const action = coreAction(p.category);
  const chainList = p.chains.slice(0, 3).join(', ') || 'its main chain';
  const mainChain = p.chains[0] ?? 'its main chain';
  const cheapNote = gas.cheap === null ? '' : ` Cheaper route: it also runs on ${gas.cheap}.`;
  const steps = [
    `Set up one dedicated wallet for ${p.name} and fund it with $${tier.low.toLocaleString('en-US')}-$${tier.high.toLocaleString('en-US')} matched to its ${tier.label} TVL: a single consistent wallet is what snapshots reward. Cost: ${gas.main}, about 20 minutes.${cheapNote}`,
    `Start on ${mainChain}: ${action.detail}. First session takes about 30 minutes; keep every transaction in the same wallet so the activity history stays attributable to you.`,
    `Repeat the core action weekly for at least 8 weeks: ${action.verb} in small, regular amounts instead of one large burst. Budget roughly $5-30 a week in fees on mainnet, under $2 a week on an L2, and 15 minutes a week of your time.`,
    `Spread the farm across its footprint: ${p.name} runs on ${chainList}${p.chains.length > 3 ? ` and ${p.chains.length - 3} more chains` : ''}. Add a second chain in week 3 and a third in week 6; bridging costs about $5-20 each way and 10 minutes, and multi-chain users are the cohort launches usually weight most.`,
    `Stay snapshot-ready from week 8 on: keep the position open, claim any points or badges the protocol issues within 48 hours of each announcement, and re-check monthly whether it still records no token. Cost after setup: about 15 minutes a month plus claim gas of $1-10.`,
  ];
  return steps.map((s) => (s.length > 600 ? s.slice(0, 597).trimEnd() + '...' : s));
}

/** Build the whole radar: the ranked board and everything the dashboard renders. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = categoryMultiples(snapshot);
  const watch = new Set(snapshot.watchlist);
  const preToken = snapshot.protocols.filter((p) => recordsNoToken(p) && !isDerivativeProduct(p));

  const scored = preToken.map((p) => {
    const f = scoreFactors(p, multiples, snapshot.as_of);
    const implied = Math.max(1, Math.round(p.tvl_usd * f.multiple * f.momentum * f.maturity * f.breadth));
    return { p, f, implied, age: ageDays(p, snapshot.as_of) };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));

  const rows: RadarRow[] = scored.map((s, i) => ({
    slug: s.p.slug,
    name: s.p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(s.p),
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    age_days: s.age,
    watchlist: watch.has(s.p.slug),
    multiple: Math.round(s.f.multiple * 1000) / 1000,
    comps: s.f.comps,
    momentum: Math.round(s.f.momentum * 1000) / 1000,
    maturity: Math.round(s.f.maturity * 1000) / 1000,
    breadth: Math.round(s.f.breadth * 1000) / 1000,
    signals: signalsOf(s.p, s.age, watch.has(s.p.slug)),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
    }));

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    pre_token: rows.length,
    live_size: live.length,
    total_implied_usd: rows.reduce((sum, r) => sum + r.implied_value_usd, 0),
    multiples: [...multiples.byCategory.entries()]
      .map(([category, v]) => ({ category, multiple: Math.round(v.multiple * 1000) / 1000, comps: v.comps }))
      .sort((a, b) => b.comps - a.comps),
    global_multiple: Math.round(multiples.global * 1000) / 1000,
    rows,
    live,
  };
  return { board, radar };
}

/** The gate's board rules, checked locally so a bad board never leaves the machine. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100-4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  for (const [i, row] of board.entries()) {
    if (!slugs.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) {
      return `row ${i + 1}: implied value ${row.implied_value_usd} out of range`;
    }
    if (row.implied_value_usd > previous) return `row ${i + 1}: implied value rises as rank ascends`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${i + 1}: ${row.farm_steps.length} farm steps, outside 3-12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${i + 1}: a farm step is ${len} characters, outside 20-600`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  if (board.length > 1 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return 'every implied value is the same: the board ranks nothing';
  }
  return null;
}

/** The dashboard's data file: the whole radar as one script the static page reads. */
export function dataScript(radar: Radar): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
