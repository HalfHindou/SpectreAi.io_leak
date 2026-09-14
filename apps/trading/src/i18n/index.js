/**
 * i18n - DEFERRED INIT CONTRACT (perf, 2026-06-08)
 *
 * This module is loaded via `whenIdle(() => import('./i18n'))` from main.jsx,
 * NOT statically. The trading app currently has ZERO useTranslation/t()
 * consumers, so nothing renders translated strings before this initializes.
 * If you add a translated component, await the exported `i18nReady` promise
 * (or accept that the first idle-frame render may show the key) - do NOT
 * move this back to a static import: the locale bundles were 2MB of the
 * critical main chunk.
 *
 * Only `en` ships statically. The other locales load on demand via
 * LOCALE_LOADERS - Vite splits each into its own lazy chunk.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'

const LOCALE_LOADERS = {
  ar: () => import('./locales/ar.json'),
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  hi: () => import('./locales/hi.json'),
  pt: () => import('./locales/pt.json'),
  ru: () => import('./locales/ru.json'),
  zh: () => import('./locales/zh.json'),
  nl: () => import('./locales/nl.json'),
  ko: () => import('./locales/ko.json'),
  ja: () => import('./locales/ja.json'),
  vi: () => import('./locales/vi.json'),
  id: () => import('./locales/id.json'),
  de: () => import('./locales/de.json'),
  tl: () => import('./locales/tl.json'),
  th: () => import('./locales/th.json'),
  pl: () => import('./locales/pl.json'),
  tr: () => import('./locales/tr.json'),
  uk: () => import('./locales/uk.json'),
  it: () => import('./locales/it.json'),
}

const readLanguage = () => {
  try {
    return JSON.parse(localStorage.getItem('spectre-settings'))?.state?.language || 'en'
  } catch {
    return 'en'
  }
}

// Load a locale bundle on demand, register it, and resolve. Safe to call
// repeatedly - addResourceBundle is idempotent and unknown languages no-op.
const _loaded = new Set(['en'])
async function loadLocale(lng) {
  if (!lng || _loaded.has(lng)) return
  const loader = LOCALE_LOADERS[lng]
  if (!loader) return
  try {
    const mod = await loader()
    i18n.addResourceBundle(lng, 'translation', mod.default || mod, true, true)
    _loaded.add(lng)
  } catch {
    /* network hiccup - fallbackLng covers rendering */
  }
}

const initialLng = readLanguage()

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: initialLng,
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

// If the stored language is non-English, pull its bundle in immediately
// (we're already off the critical path - this module loads on idle).
export const i18nReady = loadLocale(initialLng).then(() => {
  if (initialLng !== 'en') i18n.changeLanguage(initialLng)
  return i18n
})

const switchLanguage = (next) => {
  if (!next || next === i18n.language) return
  loadLocale(next).then(() => i18n.changeLanguage(next))
}

// React to language changes from the research app via the shared
// 'spectre-settings' localStorage key. The 'storage' event fires
// across browser tabs/iframes when another document mutates the same key.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== 'spectre-settings') return
    try {
      switchLanguage(JSON.parse(event.newValue)?.state?.language || 'en')
    } catch {
      /* ignore */
    }
  })
  // Also poll once on visibilitychange — some browsers don't fire the storage
  // event reliably for same-origin iframes that share the localStorage scope.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return
    switchLanguage(readLanguage())
  })
}

export default i18n
