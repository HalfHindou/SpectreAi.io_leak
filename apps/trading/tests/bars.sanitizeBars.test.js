import { describe, it, expect } from 'vitest';
import { sanitizeBars } from '../api/_lib/bars-router.js';

const bar = ([t, o, h, l, c, v]) => ({ t, o, h, l, c, v });

// Real KUNGFU (vVzBpN7...pump, Solana) 5m bars around the 2026-08-11T16:20Z rug,
// captured from prod. The 16:20 bucket is the RAW Codex bar, proven by requesting
// a <5-bar window (sanitizeBars early-returns under 5 bars, so that path serves
// unmodified upstream data). Every other bar is exactly what prod served.
const KUNGFU_RUG = [
  [1786463700, 0.000173484697829, 0.000238895639277, 0.000114588822287, 0.000230203140494, 28463.4804667],
  [1786464000, 0.000230203140494, 0.0002551647986, 0.000142093089147, 0.00014281110789, 23609.7006836],
  [1786464300, 0.00014281110789, 0.000158316675081, 0.000112622393941, 0.000133072890526, 13003.9763105],
  [1786464600, 0.000133072890526, 0.000147084205892, 0.0000734727925107, 0.0000919793474429, 25234.4159738],
  [1786464900, 0.0000919793474429, 0.000103804797026, 0.0000521003893901, 0.0000583068950282, 19491.1217071],
  // the rug: opens at 5.83e-5, wicks 36x down to 1.59e-6, closes there, on 29.3K volume
  [1786465200, 0.0000583068950282, 0.0000591218592226, 0.00000159443884616, 0.00000159443884616, 29336.7277353],
  [1786465500, 0.00000159443884616, 0.0000016393311791, 0.00000159443884616, 0.00000163504375786, 31.5068498376],
  [1786465800, 0.00000163504375786, 0.00000163504375786, 0.00000163341198095, 0.00000163341198095, 0.498815012542],
  [1786466100, 0.00000163341198095, 0.00000163368293964, 0.00000163341198095, 0.00000163368293964, 0.342727467741],
  [1786466400, 0.00000163368293964, 0.00000164681419235, 0.00000161912666206, 0.00000163912666206, 12.4],
].map(bar);

const RUG_IDX = 5;

describe('sanitizeBars', () => {
  it('keeps a real rug candle: a violent move the series FOLLOWS is not a glitch', () => {
    const out = sanitizeBars(KUNGFU_RUG);
    const got = out[RUG_IDX];
    const raw = KUNGFU_RUG[RUG_IDX];

    // the crash low must survive - this is the bar that carries the entire move
    expect(got.l).toBe(raw.l);
    expect(got.c).toBe(raw.c);
    expect(got.h).toBe(raw.h);

    // and it must never be rewritten into the impossible shape: a zero-range bar
    // carrying real volume (that shape is what broke the chart in prod)
    const zeroRangeWithVolume = got.o === got.h && got.h === got.l && got.l === got.c && got.v > 0;
    expect(zeroRangeWithVolume).toBe(false);
  });

  it('still clamps a lone wrong-price print that the series ignores', () => {
    // the documented glitch class: a BTC-priced bar inside a cheap token.
    // The series does not follow it - the next bar is back at ~1572.
    const series = Array.from({ length: 11 }, (_, i) =>
      bar([1700000000 + i * 3600, 1570, 1580, 1560, 1572, 5000]),
    );
    series[5] = bar([1700000000 + 5 * 3600, 1572, 116162, 1572, 116162, 5000]);

    const out = sanitizeBars(series);
    expect(out[5].c).toBeLessThan(2000);
    expect(out[5].h).toBeLessThan(2000);
  });

  it('still clamps a near-zero junk print that the series ignores', () => {
    const series = Array.from({ length: 11 }, (_, i) =>
      bar([1700000000 + i * 3600, 1570, 1580, 1560, 1572, 5000]),
    );
    series[5] = bar([1700000000 + 5 * 3600, 1572, 1572, 1.3e-9, 1.3e-9, 5000]);

    const out = sanitizeBars(series);
    expect(out[5].c).toBeGreaterThan(1000);
    expect(out[5].l).toBeGreaterThan(1000);
  });

  it('keeps a parabolic run (ANSEM class): every bar tracks its neighbours', () => {
    // ~480x over the series, smoothly - no bar may be touched
    const series = Array.from({ length: 24 }, (_, i) => {
      const p = 0.0007 * Math.pow(480, i / 23);
      return bar([1700000000 + i * 3600, p * 0.98, p * 1.05, p * 0.95, p, 10000]);
    });
    const out = sanitizeBars(series);
    out.forEach((b, i) => {
      expect(b.c).toBe(series[i].c);
      expect(b.l).toBe(series[i].l);
    });
  });

  it('keeps a launch candle that pumps orders of magnitude and stays pumped', () => {
    // CASHCAT class: first bar of life opens at the LP-seed price and runs 50x
    const series = [
      bar([1700000000, 2.4e-6, 1.7e-4, 2.4e-6, 1.3e-4, 79000]),
      ...Array.from({ length: 9 }, (_, i) =>
        bar([1700003600 + i * 3600, 1.3e-4, 1.45e-4, 1.2e-4, 1.35e-4, 20000]),
      ),
    ];
    const out = sanitizeBars(series, { genesisStart: true });
    expect(out[0].l).toBe(2.4e-6);
    expect(out[0].c).toBe(1.3e-4);
  });
});
