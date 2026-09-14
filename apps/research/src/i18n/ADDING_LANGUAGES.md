# Adding a Language to Spectre Research

The settings panel language picker is data-driven — adding a language is mechanical.

## Steps (3 files + 1 translation pass)

### 1. Register the locale
Edit `src/lib/currencyConfig.js`, add an entry to the `LANGUAGES` map. Use the locale code that matches the JSON filename you'll create. Pick the right `dir` (`'rtl'` for Arabic/Hebrew/Persian, otherwise `'ltr'`).

```js
export const LANGUAGES = {
  // ...existing entries...
  de: { code: 'de', name: 'German', nativeName: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}', dir: 'ltr' },
}
```

The flag is a region indicator pair (Unicode regional indicator symbols). Pick the one that matches the language's primary country. Both `settings-panel.jsx` and `mobile-settings-panel.jsx` map over `LANGUAGE_LIST` automatically — no UI edits needed.

### 2. Wire the resource into i18next
Edit `src/i18n/index.js`:
1. Add the import: `import de from '@/i18n/locales/de.json'`
2. Add to `resources`: `de: { translation: de },`

⚠️ The import will fail if `de.json` doesn't exist yet. Either create the file BEFORE adding the import, or do steps 2 + 3 in the same commit.

### 3. Create the locale JSON
The full English key set is split across TWO files for boot performance:
- `src/i18n/locales/en.json` — shell + home + common strings (eager on boot)
- `src/i18n/locales/en-rest.json` — page-specific sections (lazy, off the entry chunk)

A non-English locale is still ONE file (`de.json`) containing BOTH sets merged - only English is split. The simplest correct path:
1. Build the full English reference by merging the two files, then copy it → `de.json`:
   ```bash
   node -e "const a=require('./apps/research/src/i18n/locales/en.json'),b=require('./apps/research/src/i18n/locales/en-rest.json');require('fs').writeFileSync('apps/research/src/i18n/locales/de.json',JSON.stringify({...a,...b},null,2)+'\n')"
   ```
2. Translate every value to the target language using the rules below.

### 4. Translation rules
- Preserve JSON structure exactly. Same key paths, same nesting. No added or removed keys.
- Preserve interpolation tokens verbatim: `{{name}}`, `{{count}}`, `{{day}}`, `{{n}}`, `{{a}}`, `{{b}}`, `{{sym}}`, etc.
- Don't translate brand names: Spectre, Monarch, Solana, Ethereum, Bitcoin, Coinbase, Binance, X (the platform), DeFi, NFT, AI, GM, RWA, API, BTC/ETH/SOL ticker symbols, X Dash, X Bubbles, AI Charts Lab, etc.
- Don't translate crypto-native jargon used as English worldwide: airdrop, staking, swap, wallet, on-chain, DEX, CEX, ATH, ATL, FDV.
- Match the polish of `fr.json` and `es.json` — they're the gold standard.
- For RTL languages (`dir: 'rtl'`), the i18n context already calls `document.documentElement.dir = 'rtl'` automatically.

## Validation

Run this from the repo root after creating the file:

```bash
python3 -c "
import json
# English reference = en.json (core) + en-rest.json (page sections) merged.
en = json.load(open('apps/research/src/i18n/locales/en.json'))
en.update(json.load(open('apps/research/src/i18n/locales/en-rest.json')))
de = json.load(open('apps/research/src/i18n/locales/de.json'))
def keys(d, p=''):
  ks = set()
  for k, v in d.items():
    kp = f'{p}.{k}' if p else k
    if isinstance(v, dict): ks |= keys(v, kp)
    else: ks.add(kp)
  return ks
ek, dk = keys(en), keys(de)
print('en:', len(ek), 'de:', len(dk))
print('missing in de:', sorted(ek - dk)[:10])
print('extra in de:', sorted(dk - ek)[:10])
"
```

All three numbers should be identical (same key count, no missing, no extra).

Then `npm run build:research` should succeed without errors.

## Currently registered languages (9)

| Code | Name | Native | Dir |
|------|------|--------|-----|
| en | English | English | ltr |
| ar | Arabic | العربية | rtl |
| es | Spanish | Español | ltr |
| fr | French | Français | ltr |
| hi | Hindi | हिन्दी | ltr |
| nl | Dutch | Nederlands | ltr |
| pt | Portuguese | Português | ltr |
| ru | Russian | Русский | ltr |
| zh | Chinese | 中文 | ltr |

## Adding new translation keys (when refactoring hardcoded strings)

Always use `t(key, 'English fallback')` syntax when adding a new translation:

```jsx
<button>{t('header.signOut', 'Sign Out')}</button>
```

The fallback ensures that if any locale file is missing the key, English shows instead of `header.signOut` raw. Then add the key to `en.json` and (eventually) sync to all other locales.

When adding a new section (e.g. `tradersCorner`), pick a top-level namespace name and stick to it. Existing sections include: `nav`, `header`, `common`, `commandCenter`, `topSection`, `tradersCorner`, `researchZone`, `you`, `userDashboard`, `welcome`, `categoryFilters`, `settings`, plus many page-specific ones.
