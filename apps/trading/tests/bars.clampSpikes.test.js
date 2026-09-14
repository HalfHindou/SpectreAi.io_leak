import { describe, it, expect, beforeAll } from 'vitest';

// useCodexData reaches through to codexApi, which reads window.location at
// module scope. jsdom is not a dependency here, so stub the few globals the
// import path touches and pull the module in dynamically.
let _clampSpikes;
beforeAll(async () => {
  globalThis.window = {
    location: { hostname: 'localhost', href: 'http://localhost/', search: '' },
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  ({ _clampSpikes } = await import('../src/hooks/useCodexData.js'));
});

const bar = ([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume });

// Same real KUNGFU 5m series as bars.sanitizeBars.test.js, in the client shape.
// The 16:20 bucket (index 5) is the RAW Codex rug bar.
const KUNGFU_RUG = [
  [1786463700, 0.000173484697829, 0.000238895639277, 0.000114588822287, 0.000230203140494, 28463],
  [1786464000, 0.000230203140494, 0.0002551647986, 0.000142093089147, 0.00014281110789, 23609],
  [1786464300, 0.00014281110789, 0.000158316675081, 0.000112622393941, 0.000133072890526, 13003],
  [1786464600, 0.000133072890526, 0.000147084205892, 0.0000734727925107, 0.0000919793474429, 25234],
  [1786464900, 0.0000919793474429, 0.000103804797026, 0.0000521003893901, 0.0000583068950282, 19491],
  [1786465200, 0.0000583068950282, 0.0000591218592226, 0.00000159443884616, 0.00000159443884616, 29336],
  [1786465500, 0.00000159443884616, 0.0000016393311791, 0.00000159443884616, 0.00000163504375786, 31],
  [1786465800, 0.00000163504375786, 0.00000163504375786, 0.00000163341198095, 0.00000163341198095, 0.49],
  [1786466100, 0.00000163341198095, 0.00000163368293964, 0.00000163341198095, 0.00000163368293964, 0.34],
  [1786466400, 0.00000163368293964, 0.00000164681419235, 0.00000161912666206, 0.00000163912666206, 12.4],
].map(bar);

describe('_clampSpikes', () => {
  it('leaves a real rug untouched - a step change is not a spike', () => {
    const out = _clampSpikes(KUNGFU_RUG);
    out.forEach((b, i) => {
      expect(b.open).toBe(KUNGFU_RUG[i].open);
      expect(b.high).toBe(KUNGFU_RUG[i].high);
      expect(b.low).toBe(KUNGFU_RUG[i].low);
      expect(b.close).toBe(KUNGFU_RUG[i].close);
    });
  });

  it('still kills an isolated bad print the series ignores', () => {
    const series = Array.from({ length: 15 }, (_, i) =>
      bar([1700000000 + i * 3600, 1570, 1580, 1560, 1572, 5000]),
    );
    // one mis-priced trade: wick + close stab 70x past the local price, and the
    // next bar carries on at ~1572 as if it never happened
    series[7] = bar([1700000000 + 7 * 3600, 1572, 116162, 1572, 116162, 5000]);

    const out = _clampSpikes(series);
    expect(out[7].high).toBeLessThan(2000);
    expect(out[7].close).toBeLessThan(2000);
  });

  it('still kills a near-zero print the series ignores', () => {
    const series = Array.from({ length: 15 }, (_, i) =>
      bar([1700000000 + i * 3600, 1570, 1580, 1560, 1572, 5000]),
    );
    series[7] = bar([1700000000 + 7 * 3600, 1572, 1580, 1.3e-9, 1.3e-9, 5000]);

    const out = _clampSpikes(series);
    expect(out[7].low).toBeGreaterThan(1000);
    expect(out[7].close).toBeGreaterThan(1000);
  });

  it('leaves a sustained trend untouched', () => {
    const series = Array.from({ length: 20 }, (_, i) => {
      const p = 100 * Math.pow(1.35, i);
      return bar([1700000000 + i * 3600, p * 0.98, p * 1.04, p * 0.96, p, 9000]);
    });
    const out = _clampSpikes(series);
    out.forEach((b, i) => expect(b.close).toBe(series[i].close));
  });
});
