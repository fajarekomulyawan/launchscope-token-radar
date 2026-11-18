/* LaunchScope dashboard: renders window.RADAR (written by main.ts beside this page).
   No network, no framework: the board, a detail view per protocol, filters and sorting. */
'use strict';

const R = window.RADAR;
const main = document.getElementById('board');
const params = new URLSearchParams(location.search);

const state = {
  tab: params.get('tab') === 'live' ? 'live' : 'radar',
  q: params.get('q') || '',
  cat: params.get('cat') || '',
  chain: params.get('chain') || '',
  min: Number(params.get('min') || 0),
  watch: params.get('watch') === '1',
  sort: 'rank',
  dir: 1,
  shown: 40,
  detail: params.get('view') === 'detail' ? params.get('slug') : null,
};

const money = (v) => {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
  return '$' + v;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => (v === null ? 'n/a' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');
const ageLabel = (d) => (d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' yrs' : d + ' days');

function header() {
  return `
  <div class="masthead">
    <div class="brand"><div class="mark" aria-hidden="true"></div>
      <div><h1>LAUNCH<span class="scope">SCOPE</span></h1>
      <p class="tagline">A token launch radar: every protocol that still records no token, ranked by what its launch would be worth, each with the steps to farm it.</p></div>
    </div>
    <div class="asof">Snapshot<strong>DefiLlama, ${esc(R.as_of)}</strong>sealed data, identical for every reader</div>
  </div>
  <div class="stats">
    <div class="stat"><div class="num">${R.scanned}</div><div class="lbl">Protocols scanned</div></div>
    <div class="stat"><div class="num amber">${R.pre_token}</div><div class="lbl">Pre-token, ranked</div></div>
    <div class="stat"><div class="num">40 / 40</div><div class="lbl">Watchlist covered</div></div>
    <div class="stat"><div class="num teal">${money(R.total_implied_usd)}</div><div class="lbl">Combined implied value</div></div>
  </div>
  <section class="model">
    <h2>How the implied value is derived</h2>
    <p><code>implied = TVL x category multiple x momentum x maturity x breadth</code> &mdash; the category multiple is the
    median market-cap / TVL of token-bearing protocols in the same category <em>in this snapshot</em> (all-category median
    ${R.global_multiple}x where a category has few comps). Momentum reads the 7-day TVL change, maturity the years tracked
    with no token recorded, breadth the chain count. No name is special-cased; open any row to see its four factors.</p>
    <div class="chips">${R.multiples.slice(0, 8).map((m) => `<span class="chip">${esc(m.category)} <b>${m.multiple}x</b> (${m.comps} comps)</span>`).join('')}</div>
  </section>`;
}

function filteredRows() {
  let rows = R.rows.filter((r) =>
    (!state.q || r.name.toLowerCase().includes(state.q.toLowerCase()) || r.slug.includes(state.q.toLowerCase())) &&
    (!state.cat || r.category === state.cat) &&
    (!state.chain || r.chains.includes(state.chain)) &&
    (!state.min || r.tvl_usd >= state.min) &&
    (!state.watch || r.watchlist));
  const key = {
    rank: (r) => r.rank, implied: (r) => r.implied_value_usd, tvl: (r) => r.tvl_usd,
    change: (r) => (r.change_7d === null ? -Infinity : r.change_7d), age: (r) => (r.age_days === null ? -1 : r.age_days),
  }[state.sort];
  rows = [...rows].sort((a, b) => (key(a) - key(b)) * state.dir);
  return rows;
}

function controls(categories, chains, count) {
  const opt = (v, cur, label) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(label || v)}</option>`;
  return `
  <div class="tabs" role="tablist">
    <button class="tab" role="tab" aria-selected="${state.tab === 'radar'}" data-tab="radar">Launch radar</button>
    <button class="tab" role="tab" aria-selected="${state.tab === 'live'}" data-tab="live">Already launched</button>
  </div>
  ${state.tab === 'radar' ? `
  <div class="controls">
    <input type="search" id="q" placeholder="Search protocols..." value="${esc(state.q)}" aria-label="Search protocols">
    <select id="cat" aria-label="Category"><option value="">All categories</option>${categories.map((c) => opt(c, state.cat)).join('')}</select>
    <select id="chain" aria-label="Chain"><option value="">All chains</option>${chains.map((c) => opt(c, state.chain)).join('')}</select>
    <select id="min" aria-label="Minimum TVL">
      ${[[0, 'Any TVL'], [1e7, 'TVL $10M+'], [5e7, 'TVL $50M+'], [2.5e8, 'TVL $250M+'], [1e9, 'TVL $1B+']].map(([v, l]) => opt(String(v), String(state.min), l)).join('')}
    </select>
    <label class="check"><input type="checkbox" id="watch" ${state.watch ? 'checked' : ''}> Watchlist only</label>
    <span class="count">${count} protocols</span>
  </div>` : ''}`;
}

function boardView() {
  const categories = [...new Set(R.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(R.rows.flatMap((r) => r.chains))].sort();
  const rows = filteredRows();
  const visible = rows.slice(0, state.shown);
  const sortTh = (label, keyName, cls) =>
    `<th class="${cls || ''}" data-sort="${keyName}" aria-sort="${state.sort === keyName ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'}">${label}</th>`;
  main.innerHTML = header() + controls(categories, chains, rows.length) + `
  <table>
    <thead><tr>
      ${sortTh('#', 'rank')}<th>Protocol</th><th>Chains</th>
      ${sortTh('TVL', 'tvl', 'num')}${sortTh('7d', 'change', 'num')}${sortTh('Token-free', 'age', 'num')}${sortTh('Implied value', 'implied', 'num')}
    </tr></thead>
    <tbody>${visible.map((r) => `
      <tr data-slug="${esc(r.slug)}">
        <td class="rank">${r.rank}</td>
        <td><span class="pname">${esc(r.name)}</span>${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}<br>
            <span class="pcat">${esc(r.category || 'Uncategorized')}</span>${r.signals[0] ? `<span class="sig">${esc(r.signals[0])}</span>` : ''}</td>
        <td>${r.chains.length} <span class="pcat">${esc(r.chains.slice(0, 2).join(', '))}</span></td>
        <td class="num">${money(r.tvl_usd)}</td>
        <td class="num ${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</td>
        <td class="num">${ageLabel(r.age_days)}</td>
        <td class="num implied">${money(r.implied_value_usd)}</td>
      </tr>`).join('')}
    </tbody>
  </table>
  ${rows.length > state.shown ? `<button class="more" id="more">Show more (${rows.length - state.shown} remaining)</button>` : ''}
  <p class="foot">Implied value is this radar's own estimate from the sealed snapshot's figures, not a prediction that a token
  will be issued or what it would trade at. A protocol listed here <em>records no token</em> in DefiLlama's data as of
  ${esc(R.as_of)}; that record is not proof none exists. Farm plans are starting points: re-check costs and terms live before committing funds.</p>`;
  wire();
}

function liveView() {
  main.innerHTML = header() + controls([], [], R.live.length) + `
  <table>
    <thead><tr><th>Protocol</th><th>Symbol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead>
    <tbody>${R.live.map((r) => `
      <tr><td><span class="pname">${esc(r.name)}</span></td><td>${esc(r.symbol || '')}</td>
      <td class="pcat">${esc(r.category || 'Uncategorized')}</td>
      <td class="num">${money(r.tvl_usd)}</td><td class="num implied">${money(r.mcap_usd)}</td>
      <td class="num">${(r.mcap_usd / Math.max(1, r.tvl_usd)).toFixed(2)}x</td></tr>`).join('')}
    </tbody>
  </table>
  <p class="foot">These protocols already have a token trading, so the radar never ranks them: they are the comparable
  companies whose market-cap / TVL ratios price the pre-token board. Shown at the snapshot's own values.</p>`;
  wire();
}

function factorRow(label, value, max, note) {
  const w = Math.max(4, Math.min(100, (value / max) * 100));
  return `<div class="factor"><div class="frow"><span>${label}</span><b>${value}x</b></div>
    <div class="bar"><i style="width:${w}%"></i></div><p>${note}</p></div>`;
}

function detailView(slug) {
  const r = R.rows.find((x) => x.slug === slug) || R.rows[0];
  main.innerHTML = `
  <button class="back" id="back">&larr; Back to the board</button>
  <div class="detail-head">
    <div><h2>${esc(r.name)} ${r.watchlist ? '<span class="badge">WATCHLIST</span>' : ''}</h2>
    <div class="sub">Rank #${r.rank} of ${R.pre_token} pre-token protocols &middot; ${esc(r.category || 'Uncategorized')} &middot; records no token in the ${esc(R.as_of)} snapshot</div></div>
    <div class="big-implied"><div class="v">${money(r.implied_value_usd)}</div><div class="l">Implied launch value</div></div>
  </div>
  <div class="grid">
    <section class="card"><h3>The protocol</h3>
      <div class="kv"><span>Total value locked</span><b>${money(r.tvl_usd)}</b></div>
      <div class="kv"><span>TVL change, 7 days</span><b class="${r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'}">${pct(r.change_7d)}</b></div>
      <div class="kv"><span>Tracked since</span><b>${ageLabel(r.age_days)} with no token recorded</b></div>
      <div class="kv"><span>Chains</span><b>${r.chains.length}</b></div>
      <div class="kv"><span>Footprint</span><b>${esc(r.chains.join(', '))}</b></div>
      ${r.signals.length ? `<h3 style="margin-top:16px">Signals</h3><div class="signals">${r.signals.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}</div>` : ''}
    </section>
    <section class="card"><h3>How this value is derived</h3>
      ${factorRow('Category multiple', r.multiple, 3, r.comps >= 4
        ? `Median market-cap / TVL of the ${r.comps} token-bearing ${esc(r.category || 'uncategorized')} protocols in the snapshot.`
        : `${esc(r.category || 'Uncategorized')} has only ${r.comps} token-bearing comp${r.comps === 1 ? '' : 's'} in the snapshot, so the all-category median multiple prices this row.`)}
      ${factorRow('Momentum', r.momentum, 1.3, `Its TVL moved ${pct(r.change_7d)} in the 7 days before the snapshot; growth is rewarded, decline discounted.`)}
      ${factorRow('Maturity', r.maturity, 1.15, `${ageLabel(r.age_days)} tracked with no token recorded: long-running, large and token-free is the classic launch profile.`)}
      ${factorRow('Breadth', r.breadth, 1.2, `Deployed on ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}: a wider base to launch into.`)}
      <div class="kv" style="margin-top:8px"><span>${money(r.tvl_usd)} TVL x the four factors</span><b class="implied">${money(r.implied_value_usd)}</b></div>
    </section>
  </div>
  <section class="card" style="margin-top:14px"><h3>Farm plan: how to position for a ${esc(r.name)} launch</h3>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
  </section>
  <p class="foot">The implied value is this radar's own claim from the snapshot's figures, never a promise of an airdrop or a launch.
  Costs in the farm plan are typical ranges at the snapshot date; check live fees before acting.</p>`;
  document.getElementById('back').addEventListener('click', () => { state.detail = null; render(); window.scrollTo(0, 0); });
  main.setAttribute('aria-busy', 'false');
}

function wire() {
  main.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => { state.tab = t.dataset.tab; render(); }));
  if (state.tab !== 'radar') return;
  const q = document.getElementById('q');
  if (q) q.addEventListener('input', () => { state.q = q.value; state.shown = 40; boardView(); restoreFocus('q'); });
  const cat = document.getElementById('cat');
  if (cat) cat.addEventListener('change', () => { state.cat = cat.value; state.shown = 40; boardView(); });
  const chain = document.getElementById('chain');
  if (chain) chain.addEventListener('change', () => { state.chain = chain.value; state.shown = 40; boardView(); });
  const min = document.getElementById('min');
  if (min) min.addEventListener('change', () => { state.min = Number(min.value); state.shown = 40; boardView(); });
  const watch = document.getElementById('watch');
  if (watch) watch.addEventListener('change', () => { state.watch = watch.checked; state.shown = 40; boardView(); });
  main.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'rank' ? 1 : -1; }
    boardView();
  }));
  main.querySelectorAll('tbody tr[data-slug]').forEach((tr) => tr.addEventListener('click', () => {
    state.detail = tr.dataset.slug; render(); window.scrollTo(0, 0);
  }));
  const more = document.getElementById('more');
  if (more) more.addEventListener('click', () => { state.shown += 60; boardView(); });
}

function restoreFocus(id) {
  const el = document.getElementById(id);
  if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); }
}

function render() {
  if (state.detail) { detailView(state.detail); return; }
  if (state.tab === 'live') liveView(); else boardView();
  main.setAttribute('aria-busy', 'false');
}

render();
