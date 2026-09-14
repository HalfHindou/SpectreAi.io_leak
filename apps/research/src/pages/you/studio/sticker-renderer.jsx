/**
 * Sticker Renderer — Maps sticker type IDs to React components.
 *
 * Phase 2: CORE stickers are real components.
 * All other categories fall back to StickerPlaceholder.
 */
import BigPrice from './stickers/core/BigPrice'
import LineChart from './stickers/core/LineChart'
import CandleGhost from './stickers/core/CandleGhost'
import TickerTape from './stickers/core/TickerTape'
import FearGreedGauge from './stickers/core/FearGreedGauge'
import DominanceStrip from './stickers/core/DominanceStrip'
import NarrativeTag from './stickers/core/NarrativeTag'

// MARKET
import TopCoinsLadder from './stickers/market/TopCoinsLadder'
import SectorHeatmap from './stickers/market/SectorHeatmap'
import RotationCompass from './stickers/market/RotationCompass'
import BreadthMeter from './stickers/market/BreadthMeter'

// DERIVATIVES
import LiquidationBars from './stickers/derivatives/LiquidationBars'
import OIPulse from './stickers/derivatives/OIPulse'
import FundingStrip from './stickers/derivatives/FundingStrip'
import GhostHeatmap from './stickers/derivatives/GhostHeatmap'

// MACRO
import MacroStrip from './stickers/macro/MacroStrip'
import CorrelationBreakdown from './stickers/macro/CorrelationBreakdown'
import RegimeBadge from './stickers/macro/RegimeBadge'
import SignalStack from './stickers/macro/SignalStack'

// SENTIMENT
import CTMood from './stickers/sentiment/CTMood'
import WhaleActivity from './stickers/sentiment/WhaleActivity'
import SmartMoneyFlow from './stickers/sentiment/SmartMoneyFlow'

// EDITORIAL
import QuoteBlock from './stickers/editorial/QuoteBlock'
import BigLabel from './stickers/editorial/BigLabel'
import Headline from './stickers/editorial/Headline'
import StatBlock from './stickers/editorial/StatBlock'

// MEDIA
import MarketClock from './stickers/media/MarketClock'
import Countdown from './stickers/media/Countdown'
import AudioVisualizer from './stickers/media/AudioVisualizer'

// ART
import PaintedBTC from './stickers/art/PaintedBTC'
import WarholGrid from './stickers/art/WarholGrid'
import DripPrice from './stickers/art/DripPrice'
import StencilWord from './stickers/art/StencilWord'
import GraffitiCrown from './stickers/art/GraffitiCrown'
import ThrowUp from './stickers/art/ThrowUp'
import RansomNote from './stickers/art/RansomNote'
import EchoText from './stickers/art/EchoText'

/**
 * Registry of sticker type → React component.
 * Returns null for unimplemented types (caller should use placeholder).
 */
const STICKER_COMPONENTS = {
  // CORE (Phase 2)
  'big-price': BigPrice,
  'line-chart': LineChart,
  'candle-ghost': CandleGhost,
  'ticker-tape': TickerTape,
  'fear-greed-gauge': FearGreedGauge,
  'dominance-strip': DominanceStrip,
  'narrative-tag': NarrativeTag,

  // MARKET
  'top-coins-ladder': TopCoinsLadder,
  'sector-heatmap': SectorHeatmap,
  'rotation-compass': RotationCompass,
  'breadth-meter': BreadthMeter,

  // DERIVATIVES
  'liquidation-bars': LiquidationBars,
  'oi-pulse': OIPulse,
  'funding-strip': FundingStrip,
  'ghost-heatmap': GhostHeatmap,

  // MACRO
  'macro-strip': MacroStrip,
  'correlation-breakdown': CorrelationBreakdown,
  'regime-badge': RegimeBadge,
  'signal-stack': SignalStack,

  // SENTIMENT
  'ct-mood': CTMood,
  'whale-activity': WhaleActivity,
  'smart-money-flow': SmartMoneyFlow,

  // EDITORIAL
  'quote-block': QuoteBlock,
  'big-label': BigLabel,
  'headline': Headline,
  'stat-block': StatBlock,

  // MEDIA
  'market-clock': MarketClock,
  'countdown': Countdown,
  'audio-visualizer': AudioVisualizer,

  // ART
  'painted-btc': PaintedBTC,
  'warhol-grid': WarholGrid,
  'drip-price': DripPrice,
  'stencil-word': StencilWord,
  'graffiti-crown': GraffitiCrown,
  'throw-up': ThrowUp,
  'ransom-note': RansomNote,
  'echo-text': EchoText,
}

/**
 * Get the React component for a sticker type.
 * Returns the component or null if not yet implemented.
 */
export function getStickerComponent(type) {
  return STICKER_COMPONENTS[type] || null
}
