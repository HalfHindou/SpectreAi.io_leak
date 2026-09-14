import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCopyToast } from '@/contexts/CopyToastContext'
import './pricing.css'

/* ── Inline SVGs ── */
const CheckIcon = () => (
  <svg className="pricing-check-icon" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" strokeWidth="2">
    <path d="M5 13l4 4L19 7" />
  </svg>
)

const ChevronIcon = ({ open }) => (
  <svg
    className={`pricing-chevron${open ? ' pricing-chevron--open' : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M8.25 4.5l7.5 7.5-7.5 7.5" />
  </svg>
)

/* ── Tier data ── USD prices are literal by product decision. Feature/CTA copy
   translates via featureKeys/ctaKey, but $0 / $29 / $99 / $232/yr remain USD. */
const TIERS = [
  {
    id: 'free',
    monthlyPrice: '$0',
    yearlyPrice: '$0',
    priceSuffix: '',
    yearlyTotal: null,
    featureKeys: ['top100Coins', 'basicMarketData', 'aiSearches3', 'publicArticles'],
    ctaStyle: 'ghost',
    cryptoLink: false,
    badge: false,
    glow: false,
    hasSubtext: true,
  },
  {
    id: 'pro',
    monthlyPrice: '$29',
    yearlyPrice: '$19',
    priceSuffix: '/mo',
    yearlyTotal: '$232/yr',
    featureKeys: ['aiScreener', 'unlimitedSearch', 'voiceMode', 'predictionMarkets', 'aiAgentsBasic'],
    ctaStyle: 'purple',
    cryptoLink: true,
    badge: true,
    glow: false,
    hasSubtext: false,
  },
  {
    id: 'elite',
    monthlyPrice: '$99',
    yearlyPrice: '$66',
    priceSuffix: '/mo',
    yearlyTotal: '$792/yr',
    featureKeys: ['everythingInPro', 'tradingTerminal', 'deepThesis', 'aiAgentsFull', 'apiAccess'],
    ctaStyle: 'purple',
    cryptoLink: true,
    badge: false,
    glow: true,
    hasSubtext: false,
  },
  {
    id: 'institutional',
    monthlyPrice: '$499',
    yearlyPrice: '$499',
    priceSuffix: '/mo',
    yearlyTotal: null,
    noYearlyDiscount: true,
    featureKeys: ['everythingInElite', 'teamSeats', 'whiteLabel', 'customReports'],
    ctaStyle: 'ghost',
    cryptoLink: false,
    badge: false,
    glow: false,
    hasSubtext: false,
  },
]

/* FAQ keys — text resolves via t() at render */
const FAQ_KEYS = ['spectreToken', 'tokensVsPayment', 'freeTier', 'cryptoPayment', 'upgrade']

/* Token thresholds — amounts literal, labels translate */
const THRESHOLDS = [
  { amount: '500', labelKey: 'starter' },
  { amount: '1,000', labelKey: 'pro' },
  { amount: '7,000', labelKey: 'elite' },
]

/* ── Component ── */
export default function PricingPage() {
  const { t } = useTranslation()
  const [billingCycle, setBillingCycle] = useState('monthly')
  const [openFaq, setOpenFaq] = useState(null)
  const { triggerCopyToast } = useCopyToast()

  const isYearly = billingCycle === 'yearly'

  return (
    <div className="pricing-page">
      {/* ─── Hero ─── */}
      <section className="pricing-hero">
        <h1 className="pricing-hero-title">{t('pricing.hero.title', 'Choose your intelligence tier')}</h1>
        <p className="pricing-hero-sub">
          {t('pricing.hero.subtitle', 'Pay with card, crypto, or hold $SPECTRE tokens for free access.')}
        </p>
      </section>

      {/* ─── Billing Toggle ─── */}
      <div className="pricing-toggle-wrap">
        <div className="pricing-toggle-pill">
          <button
            className={`pricing-toggle-btn${!isYearly ? ' pricing-toggle-btn--active' : ''}`}
            onClick={() => setBillingCycle('monthly')}
          >
            {t('pricing.toggle.monthly', 'Monthly')}
          </button>
          <button
            className={`pricing-toggle-btn${isYearly ? ' pricing-toggle-btn--active' : ''}`}
            onClick={() => setBillingCycle('yearly')}
          >
            {t('pricing.toggle.yearly', 'Yearly')}
          </button>
        </div>
        {isYearly && <span className="pricing-save-badge">{t('pricing.toggle.save', 'Save 33%')}</span>}
      </div>

      {/* ─── Tier Cards ─── */}
      <div className="pricing-grid">
        {TIERS.map((tier) => {
          const price = isYearly && !tier.noYearlyDiscount ? tier.yearlyPrice : tier.monthlyPrice
          const tierName = t(`pricing.tiers.${tier.id}.name`, defaultTierName(tier.id))
          const ctaLabel = t(`pricing.tiers.${tier.id}.cta`, defaultTierCta(tier.id))
          const ctaMessage = t(`pricing.tiers.${tier.id}.ctaMessage`, defaultTierMessage(tier.id))
          return (
            <div
              key={tier.id}
              className={`pricing-card${tier.glow ? ' pricing-card--glow' : ''}`}
            >
              {tier.badge && (
                <span className="pricing-badge">{t('pricing.tiers.pro.badge', 'MOST POPULAR')}</span>
              )}
              <h3 className="pricing-card-name">{tierName}</h3>
              <div className="pricing-card-price-row">
                <span className="pricing-card-price">{price}</span>
                {tier.priceSuffix && (
                  <span className="pricing-card-suffix">{tier.priceSuffix}</span>
                )}
              </div>
              {tier.hasSubtext && (
                <span className="pricing-card-subtext">{t('pricing.tiers.free.subtext', 'forever')}</span>
              )}
              {isYearly && tier.yearlyTotal && !tier.noYearlyDiscount && (
                <span className="pricing-card-yearly-total">{tier.yearlyTotal}</span>
              )}
              <ul className="pricing-features">
                {tier.featureKeys.map((featureKey) => (
                  <li key={featureKey} className="pricing-feature">
                    <CheckIcon />
                    <span>{t(`pricing.features.${featureKey}`, defaultFeatureText(featureKey))}</span>
                  </li>
                ))}
              </ul>
              <button
                className={`pricing-cta pricing-cta--${tier.ctaStyle}`}
                onClick={() => triggerCopyToast(ctaMessage)}
              >
                {ctaLabel}
              </button>
              {tier.cryptoLink && (
                <button
                  className="pricing-crypto-link"
                  onClick={() =>
                    triggerCopyToast(t('pricing.cryptoPaymentToast', 'Crypto payments coming soon.'))
                  }
                >
                  {t('pricing.payWithCrypto', 'Pay with Crypto')}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* ─── Token Holder Banner ─── */}
      <section className="pricing-token-banner">
        <p className="pricing-token-title">
          {t('pricing.tokenBanner.title', 'Already hold $SPECTRE? You may already have Pro or Elite access for free.')}
        </p>
        <div className="pricing-thresholds">
          {THRESHOLDS.map((row) => (
            <span key={row.labelKey} className="pricing-threshold-pill">
              {t('pricing.tokenBanner.threshold', '{{amount}} SPECT → {{label}}', {
                amount: row.amount,
                label: t(`pricing.tokenBanner.labels.${row.labelKey}`, defaultThresholdLabel(row.labelKey)),
              })}
            </span>
          ))}
        </div>
        <button
          className="pricing-cta pricing-cta--purple pricing-token-cta"
          onClick={() => triggerCopyToast(t('pricing.tokenBanner.walletToast', 'Wallet connect coming soon.'))}
        >
          {t('pricing.tokenBanner.cta', 'Check My Wallet')}
        </button>
      </section>

      {/* ─── FAQ ─── */}
      <section className="pricing-faq">
        <h2 className="pricing-faq-heading">{t('pricing.faq.heading', 'Frequently Asked Questions')}</h2>
        {FAQ_KEYS.map((faqKey, i) => {
          const isOpen = openFaq === i
          return (
            <div
              key={faqKey}
              className={`pricing-faq-item${isOpen ? ' pricing-faq-item--open' : ''}`}
            >
              <button
                className="pricing-faq-question"
                onClick={() => setOpenFaq(isOpen ? null : i)}
              >
                <span>{t(`pricing.faq.${faqKey}.q`, defaultFaqQ(faqKey))}</span>
                <ChevronIcon open={isOpen} />
              </button>
              <div className="pricing-faq-answer-wrap">
                <p className="pricing-faq-answer">{t(`pricing.faq.${faqKey}.a`, defaultFaqA(faqKey))}</p>
              </div>
            </div>
          )
        })}
      </section>
    </div>
  )
}

/* ── EN defaults so the page still renders if a locale key is missing ── */

function defaultTierName(id) {
  switch (id) {
    case 'free': return 'Free'
    case 'pro': return 'Pro'
    case 'elite': return 'Elite'
    case 'institutional': return 'Institutional'
    default: return id
  }
}

function defaultTierCta(id) {
  switch (id) {
    case 'free': return 'Get Started'
    case 'pro': return 'Start 7-Day Trial'
    case 'elite': return 'Get Elite'
    case 'institutional': return 'Contact Us'
    default: return 'Choose'
  }
}

function defaultTierMessage(id) {
  switch (id) {
    case 'free': return 'Free tier is already active.'
    case 'pro':
    case 'elite': return "Payment coming soon — we'll notify you when ready."
    case 'institutional': return 'Contact sales@spectreai.io for institutional access.'
    default: return ''
  }
}

function defaultFeatureText(key) {
  switch (key) {
    case 'top100Coins': return 'Top 100 coins'
    case 'basicMarketData': return 'Basic market data'
    case 'aiSearches3': return '3 AI searches/day'
    case 'publicArticles': return 'Public articles'
    case 'aiScreener': return 'AI Screener'
    case 'unlimitedSearch': return 'Unlimited search'
    case 'voiceMode': return 'Voice Mode'
    case 'predictionMarkets': return 'Prediction Markets'
    case 'aiAgentsBasic': return 'AI Agents basic'
    case 'everythingInPro': return 'Everything in Pro'
    case 'tradingTerminal': return 'Trading Terminal'
    case 'deepThesis': return 'Deep Thesis'
    case 'aiAgentsFull': return 'AI Agents full + x402'
    case 'apiAccess': return 'API access'
    case 'everythingInElite': return 'Everything in Elite'
    case 'teamSeats': return 'Team seats'
    case 'whiteLabel': return 'White-label widgets'
    case 'customReports': return 'Custom reports'
    default: return key
  }
}

function defaultThresholdLabel(key) {
  switch (key) {
    case 'starter': return 'Starter'
    case 'pro': return 'Pro'
    case 'elite': return 'Elite'
    default: return key
  }
}

function defaultFaqQ(key) {
  switch (key) {
    case 'spectreToken': return 'What is $SPECTRE and how do I get it?'
    case 'tokensVsPayment': return 'Do I need to pay if I hold enough tokens?'
    case 'freeTier': return "What's included in the free tier?"
    case 'cryptoPayment': return 'Can I pay with crypto?'
    case 'upgrade': return 'How do I upgrade from Free to Pro?'
    default: return ''
  }
}

function defaultFaqA(key) {
  switch (key) {
    case 'spectreToken':
      return '$SPECTRE is the native token of the Spectre ecosystem on Ethereum. You can acquire it on Uniswap or other DEXs. Holding $SPECTRE tokens grants you automatic access to premium tiers based on your balance — no subscription needed.'
    case 'tokensVsPayment':
      return 'No. If your connected wallet holds enough $SPECTRE tokens, you automatically receive the corresponding tier. 500+ tokens unlocks Starter access, 1,000+ unlocks Pro, and 7,000+ unlocks Elite — all without any monthly payment.'
    case 'freeTier':
      return 'The free tier includes access to top 100 coins, basic market overview data including Fear & Greed index, 3 AI search queries per day, and all public Intelligence Hub articles. No credit card required.'
    case 'cryptoPayment':
      return 'Yes. We accept BTC, ETH, USDC, USDT, SOL, and $SPECTRE via NOWPayments. Paying with $SPECTRE tokens gives you an automatic 10% discount on any subscription tier.'
    case 'upgrade':
      return 'Click any upgrade button on this page or in your dashboard. You can pay monthly or yearly with a card, pay with crypto, or simply connect a wallet holding 1,000+ $SPECTRE tokens to unlock Pro access automatically.'
    default: return ''
  }
}
