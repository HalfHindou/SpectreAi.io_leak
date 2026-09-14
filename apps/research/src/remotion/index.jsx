/**
 * Remotion Root - Composition Registry
 * All crypto animation compositions for Spectre AI
 */
import { Composition, registerRoot } from 'remotion'
import { CryptoPriceAction } from './CryptoPriceAction'
import { MarketOverview } from './MarketOverview'
import { SentimentPulse } from './SentimentPulse'
import { SpectreShowcase } from './SpectreShowcase'

// Token brand colors
const TOKEN_COLORS = {
  BTC: { color: '#F7931A', rgb: '247, 147, 26' },
  ETH: { color: '#627EEA', rgb: '98, 126, 234' },
  SOL: { color: '#00FFA3', rgb: '0, 255, 163' },
  BNB: { color: '#F0B90B', rgb: '240, 185, 11' },
  XRP: { color: '#00AAE4', rgb: '0, 170, 228' },
  ADA: { color: '#0033AD', rgb: '0, 51, 173' },
  DOGE: { color: '#C2A633', rgb: '194, 166, 51' },
  AVAX: { color: '#E84142', rgb: '232, 65, 66' },
  DOT: { color: '#E6007A', rgb: '230, 0, 122' },
  MATIC: { color: '#8247E5', rgb: '130, 71, 229' },
  LINK: { color: '#2A5ADA', rgb: '42, 90, 218' },
  UNI: { color: '#FF007A', rgb: '255, 0, 122' },
}

export const RemotionRoot = () => {
  return (
    <>
      {/* Price Action compositions for each token */}
      {Object.entries(TOKEN_COLORS).map(([symbol, colors]) => (
        <Composition
          key={`price-${symbol}`}
          id={`CryptoPriceAction-${symbol}`}
          component={CryptoPriceAction}
          durationInFrames={300} // 10 seconds at 30fps
          fps={30}
          width={400}
          height={300}
          defaultProps={{
            symbol,
            brandColor: colors.color,
            brandColorRGB: colors.rgb,
          }}
        />
      ))}

      {/* Generic price action (for custom tokens) */}
      <Composition
        id="CryptoPriceAction"
        component={CryptoPriceAction}
        durationInFrames={300}
        fps={30}
        width={400}
        height={300}
        defaultProps={{
          symbol: 'BTC',
          brandColor: '#F7931A',
          brandColorRGB: '247, 147, 26',
        }}
      />

      {/* Market Overview (hero background) */}
      <Composition
        id="MarketOverview"
        component={MarketOverview}
        durationInFrames={600} // 20 seconds
        fps={30}
        width={1920}
        height={600}
      />

      {/* Sentiment Pulse gauge */}
      <Composition
        id="SentimentPulse"
        component={SentimentPulse}
        durationInFrames={300}
        fps={30}
        width={400}
        height={400}
        defaultProps={{
          sentimentValue: 65,
          symbol: 'BTC',
        }}
      />

      {/* Sentiment variations */}
      {[
        { name: 'Fear', value: 25 },
        { name: 'Neutral', value: 50 },
        { name: 'Greed', value: 75 },
        { name: 'ExtremeGreed', value: 90 },
      ].map(({ name, value }) => (
        <Composition
          key={`sentiment-${name}`}
          id={`SentimentPulse-${name}`}
          component={SentimentPulse}
          durationInFrames={300}
          fps={30}
          width={400}
          height={400}
          defaultProps={{
            sentimentValue: value,
            symbol: 'MARKET',
          }}
        />
      ))}
      {/* 4K Showcase - Apple-style product video */}
      <Composition
        id="SpectreShowcase"
        component={SpectreShowcase}
        durationInFrames={600} // 20 seconds
        fps={30}
        width={3840}
        height={2160}
      />

      {/* 1080p variant for faster preview */}
      <Composition
        id="SpectreShowcase-1080p"
        component={SpectreShowcase}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  )
}

export default RemotionRoot

registerRoot(RemotionRoot)
