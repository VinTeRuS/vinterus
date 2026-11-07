// Generates assets/stats.svg, assets/langs.svg, assets/streak.svg from the GitHub GraphQL API.
// Public data only. Needs GITHUB_TOKEN (the default Actions token is enough). No dependencies.
import { writeFileSync, mkdirSync } from 'node:fs';

const LOGIN = process.env.STATS_USER || 'VinTeRuS';
const TOKEN = process.env.GITHUB_TOKEN;
const OUT = process.env.STATS_OUT || 'assets';
if (!TOKEN) throw new Error('GITHUB_TOKEN is not set');
mkdirSync(OUT, { recursive: true });

const C = {
  bg: '#0d1b2a', border: '#1f4e8c', title: '#6fa8ff', text: '#c9d1d9',
  num: '#e6edf3', dim: '#8b949e', accent: '#9bd1ff', star: '#cfe3ff',
};
const FONT = `font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace"`;

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${TOKEN}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(JSON.stringify(json.errors || json));
  return json.data;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

// Deterministic pixel stars so the cards match the TARDIS banner.
function stars(w, h, count, seed) {
  let s = seed, out = '';
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rnd() * (w - 8) / 2) * 2 + 4, y = Math.floor(rnd() * (h - 8) / 2) * 2 + 4;
    const size = rnd() > 0.85 ? 3 : 2, op = (0.12 + rnd() * 0.3).toFixed(2);
    out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${C.star}" opacity="${op}"/>`;
  }
  return out;
}

function frame(w, h, title, body, seed) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" role="img" aria-label="${esc(title)}">
<rect width="${w}" height="${h}" fill="${C.bg}"/>
<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="${C.border}" stroke-width="4"/>
<rect x="0" y="0" width="6" height="6" fill="${C.bg}"/><rect x="${w - 6}" y="0" width="6" height="6" fill="${C.bg}"/>
<rect x="0" y="${h - 6}" width="6" height="6" fill="${C.bg}"/><rect x="${w - 6}" y="${h - 6}" width="6" height="6" fill="${C.bg}"/>
${stars(w, h, 14, seed)}
<text x="24" y="38" ${FONT} font-size="16" font-weight="700" fill="${C.title}">${esc(title)}</text>
${body}
</svg>
`;
}

const now = new Date();
const base = await gql(`query($login:String!){ user(login:$login){
  name login createdAt followers{totalCount}
  pullRequests{totalCount} issues{totalCount}
  repositories(ownerAffiliations:OWNER, privacy:PUBLIC, first:100){ totalCount nodes{
    isFork stargazerCount
    languages(first:10, orderBy:{field:SIZE, direction:DESC}){ edges{ size node{ name color } } }
  } }
} }`, { login: LOGIN });
const u = base.user;

// Contribution calendar for every year since the account was created.
const days = [];
let totalCommits = 0;
for (let y = new Date(u.createdAt).getUTCFullYear(); y <= now.getUTCFullYear(); y++) {
  const created = new Date(u.createdAt);
  const from = (y === created.getUTCFullYear() ? created : new Date(Date.UTC(y, 0, 1))).toISOString();
  const to = (y === now.getUTCFullYear() ? now : new Date(Date.UTC(y, 11, 31, 23, 59, 59))).toISOString();
  const d = await gql(`query($login:String!,$from:DateTime!,$to:DateTime!){ user(login:$login){
    contributionsCollection(from:$from,to:$to){ totalCommitContributions
      contributionCalendar{ weeks{ contributionDays{ date contributionCount } } } } } }`, { login: LOGIN, from, to });
  const cc = d.user.contributionsCollection;
  totalCommits += cc.totalCommitContributions;
  for (const w of cc.contributionCalendar.weeks) days.push(...w.contributionDays);
}
days.sort((a, b) => a.date.localeCompare(b.date));
const today = now.toISOString().slice(0, 10);
const series = days.filter((d) => d.date <= today);
const totalContrib = series.reduce((s, d) => s + d.contributionCount, 0);

let longest = 0, run = 0, longestEnd = null;
for (const d of series) {
  run = d.contributionCount > 0 ? run + 1 : 0;
  if (run > longest) { longest = run; longestEnd = d.date; }
}
// Current streak: today may still be empty without breaking it.
let current = 0, i = series.length - 1;
if (i >= 0 && series[i].contributionCount === 0) i--;
for (; i >= 0 && series[i].contributionCount > 0; i--) current++;

const own = u.repositories.nodes.filter((r) => !r.isFork);
const stars_ = own.reduce((s, r) => s + r.stargazerCount, 0);

// ---- stats.svg
{
  const rows = [
    ['★', 'Stars', stars_], ['◆', 'Commits', totalCommits], ['⇅', 'Pull requests', u.pullRequests.totalCount],
    ['!', 'Issues', u.issues.totalCount], ['▣', 'Public repos', own.length], ['☺', 'Followers', u.followers.totalCount],
  ];
  const body = rows.map(([ic, label, v], k) => {
    const y = 72 + k * 24;
    return `<text x="24" y="${y}" ${FONT} font-size="13" fill="${C.accent}">${ic}</text>
<text x="44" y="${y}" ${FONT} font-size="13" fill="${C.text}">${label}</text>
<text x="276" y="${y}" ${FONT} font-size="13" font-weight="700" fill="${C.num}" text-anchor="end">${fmt(v)}</text>`;
  }).join('\n');
  writeFileSync(`${OUT}/stats.svg`, frame(300, 210, `${u.name || u.login} · stats`, body, 7));
}

// ---- langs.svg
{
  const by = new Map();
  for (const r of own) for (const e of r.languages.edges) {
    const cur = by.get(e.node.name) || { size: 0, color: e.node.color || C.dim };
    cur.size += e.size; by.set(e.node.name, cur);
  }
  const top = [...by.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6);
  const sum = top.reduce((s, [, v]) => s + v.size, 0) || 1;
  let x = 24; const barW = 252;
  const bar = top.map(([, v], k) => {
    const w = k === top.length - 1 ? 24 + barW - x : Math.max(2, Math.round((v.size / sum) * barW / 2) * 2);
    const r = `<rect x="${x}" y="54" width="${w}" height="10" fill="${v.color}"/>`; x += w; return r;
  }).join('');
  const list = top.map(([name, v], k) => {
    const col = k % 2, row = Math.floor(k / 2), lx = 24 + col * 132, ly = 94 + row * 26;
    return `<rect x="${lx}" y="${ly - 9}" width="10" height="10" fill="${v.color}"/>
<text x="${lx + 16}" y="${ly}" ${FONT} font-size="12" fill="${C.text}">${esc(name)}</text>
<text x="${lx + 124}" y="${ly}" ${FONT} font-size="11" fill="${C.dim}" text-anchor="end">${((v.size / sum) * 100).toFixed(1)}%</text>`;
  }).join('\n');
  writeFileSync(`${OUT}/langs.svg`, frame(300, 210, 'Top languages', bar + '\n' + list, 13));
}

// ---- streak.svg
{
  const d = (s) => s ? new Date(s + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—';
  const col = (cx, big, label, sub, hi) => `<text x="${cx}" y="112" ${FONT} font-size="${hi ? 34 : 26}" font-weight="700" fill="${C.num}" text-anchor="middle">${fmt(big)}</text>
<text x="${cx}" y="142" ${FONT} font-size="12" fill="${hi ? C.title : C.text}" text-anchor="middle">${label}</text>
<text x="${cx}" y="162" ${FONT} font-size="10" fill="${C.dim}" text-anchor="middle">${sub}</text>`;
  const body = [
    col(84, totalContrib, 'Contributions', `${d(series[0]?.date)} – now`, false),
    `<rect x="166" y="70" width="4" height="96" fill="${C.border}"/>`,
    col(248, current, 'Current streak', current ? 'days in a row' : 'start one today', true),
    `<rect x="326" y="70" width="4" height="96" fill="${C.border}"/>`,
    col(412, longest, 'Longest streak', longestEnd ? `ended ${d(longestEnd)}` : '—', false),
  ].join('\n');
  writeFileSync(`${OUT}/streak.svg`, frame(496, 210, 'Contribution streak', body, 29));
}

console.log({ stars: stars_, totalCommits, totalContrib, current, longest, repos: own.length });
