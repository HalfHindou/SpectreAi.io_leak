const fetch = require('node-fetch');

async function main() {
  const res = await fetch('http://localhost:3001/api/polymarket/events');
  const data = await res.json();
  console.log('Total events:', data.length);

  const skip = ['up-or-down', '5m', '4h', '15m', '1h', '30m', '10m', 'recurring'];
  const filtered = data.filter(e => {
    const tags = (e.tags || []).map(t => (t.slug || '').toLowerCase());
    return tags.every(s => skip.indexOf(s) === -1);
  });
  console.log('After skip filter:', filtered.length);

  const cats = {};
  for (const e of filtered) {
    for (const t of (e.tags || [])) {
      cats[t.slug] = (cats[t.slug] || 0) + 1;
    }
  }
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log('\nTop tags:');
  sorted.forEach(([k, v]) => console.log(`  ${k}: ${v}`));

  // Show highest volume markets
  const rows = [];
  for (const e of filtered) {
    for (const m of (e.markets || [])) {
      if (m.closed) continue;
      const vol = parseFloat(m.volume) || parseFloat(m.volumeNum) || 0;
      rows.push({
        q: (m.question || e.title || '').substring(0, 60),
        vol,
        tags: (e.tags || []).map(t => t.slug).join(','),
      });
    }
  }
  rows.sort((a, b) => b.vol - a.vol);
  console.log('\nTop 15 by volume:');
  rows.slice(0, 15).forEach((r, i) => {
    console.log(`  ${i + 1}. [${r.tags}] ${r.q} — $${r.vol.toLocaleString()}`);
  });
}

main().catch(console.error);
