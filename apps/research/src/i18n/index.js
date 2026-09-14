import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
// Only English is bundled eagerly. The other 19 locales are code-split into
// their own chunks and dynamic-imported on demand (detected language at boot,
// or a runtime language switch) so the ~19 locale JSONs don't sit on the
// critical path. Missing keys fall back to `en` during the brief load tick.
//
// perf: en.json holds ONLY shell + home + common strings (the first-paint set).
// The page-specific sections (tokenizedAssets, economicCalendar, xDash, you,
// ...) live in en-rest.json and are dynamic-imported immediately below - off
// the entry chunk (~100KB raw), but fetched in parallel at boot so they're
// merged before any lazy page can mount. Edit page strings in en-rest.json.
import en from '@/i18n/locales/en.json'

const SUPPORTED = ['ar', 'es', 'fr', 'hi', 'pt', 'ru', 'zh', 'nl', 'ko', 'ja', 'vi', 'id', 'de', 'tl', 'th', 'pl', 'tr', 'uk', 'it']

const detected = (() => {
  try { return JSON.parse(localStorage.getItem('spectre-settings'))?.state?.language || 'en' } catch { return 'en' }
})()

i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: detected,
  fallbackLng: 'en',
  // Suppress the i18next/Locize promo console.info that ships in
  // production bundles (its NODE_ENV gate never fires under Vite).
  showSupportNotice: false,
  interpolation: {
    escapeValue: false,
  },
})

// Merge the deferred English page-strings into the `en` bundle. Fired at module
// eval (boot), so en-rest downloads in parallel with the entry/vendor chunks and
// lands before lazy pages mount. Deep-merge + overwrite so it fills the page
// namespaces without clobbering the core ones. English-only: non-English users
// get these namespaces from their own full locale file via loadLocale().
import('@/i18n/locales/en-rest.json')
  .then((mod) => i18n.addResourceBundle('en', 'translation', mod.default || mod, true, true))
  .catch(() => { /* page strings fall back to their keys if this ever fails */ })

// Lazy-load a non-English locale chunk, register it, then activate it.
// Vite turns the templated import into one chunk per locale JSON.
async function loadLocale(lng) {
  if (!lng || lng === 'en' || !SUPPORTED.includes(lng)) return
  if (i18n.hasResourceBundle(lng, 'translation')) return
  try {
    const mod = await import(`@/i18n/locales/${lng}.json`)
    i18n.addResourceBundle(lng, 'translation', mod.default || mod, true, true)
    if (i18n.language !== lng) await i18n.changeLanguage(lng)
  } catch (_) { /* keep `en` fallback on failure */ }
}

// Boot: fetch the detected language if it isn't English.
if (detected !== 'en') loadLocale(detected)

// Runtime: the settings language selector calls i18n.changeLanguage, which
// fires this - load the chunk if it's not registered yet (no-op once cached).
i18n.on('languageChanged', (lng) => {
  if (lng && lng !== 'en' && SUPPORTED.includes(lng) && !i18n.hasResourceBundle(lng, 'translation')) {
    loadLocale(lng)
  }
})

export default i18n
