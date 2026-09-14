/**
 * SpectreShowcase - 4K Cinematic Apple-Style Product Video
 *
 * A premium showcase composition featuring:
 * - Realistic MacBook Pro frame with platform screenshots
 * - Floating UI elements with spring physics
 * - Apple-style mesh gradient backgrounds
 * - Cinematic text reveals and transitions
 * - Particle fields, light rays, and glow effects
 *
 * Duration: 20 seconds @ 30fps (600 frames) - 3840x2160 (4K)
 */
import React, { useMemo } from 'react'
import {
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
  Img,
  staticFile,
} from 'remotion'

/* ─────────────── SCENE TIMELINE (frames @ 30fps) ─────────────── */
const SCENES = {
  // Act 1 - Grand entrance
  gradientFadeIn:    [0, 30],      // 0–1s    background gradient breathes in
  logoReveal:        [25, 70],     // 0.8–2.3s  logo + wordmark materialize
  taglineReveal:     [60, 110],    // 2–3.6s  tagline types in
  logoFadeOut:       [110, 135],   // 3.6–4.5s  logo dissolves

  // Act 2 - The hero shot
  macbookEnter:      [130, 200],   // 4.3–6.6s  MacBook rises from below
  screenReveal:      [185, 230],   // 6.1–7.6s  screen illuminates
  floatingElements:  [220, 340],   // 7.3–11.3s  UI cards fly out
  featureTexts:      [280, 400],   // 9.3–13.3s  feature callouts

  // Act 3 - Finale
  zoomPull:          [390, 460],   // 13–15.3s  camera pulls back
  ctaReveal:         [440, 520],   // 14.6–17.3s  CTA text
  finalFlash:        [510, 540],   // 17–18s  subtle flash
  endHold:           [540, 600],   // 18–20s  hold on final frame
}

/* ─────────────── HELPERS ─────────────── */
const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

const springIn = (frame, delay, config = {}) =>
  spring({
    frame: Math.max(0, frame - delay),
    fps: 30,
    config: { damping: 14, stiffness: 80, mass: 1, ...config },
  })

const fadeRange = (frame, inStart, inEnd, outStart, outEnd) => {
  if (frame < inStart) return 0
  if (frame <= inEnd) return interpolate(frame, [inStart, inEnd], [0, 1], { extrapolateRight: 'clamp' })
  if (frame < outStart) return 1
  if (frame <= outEnd) return interpolate(frame, [outStart, outEnd], [1, 0], { extrapolateRight: 'clamp' })
  return 0
}

/* ─────────────── BACKGROUND ─────────────── */
const MeshGradientBg = ({ width, height, frame }) => {
  // Slow drifting color orbs - Apple-style mesh gradient
  const t = frame * 0.004
  const orbs = [
    { cx: 0.25 + Math.sin(t * 1.1) * 0.08, cy: 0.3 + Math.cos(t * 0.9) * 0.06, r: 0.45, color: 'rgba(88, 28, 135, 0.55)' },   // deep purple
    { cx: 0.75 + Math.cos(t * 0.8) * 0.1,  cy: 0.6 + Math.sin(t * 1.2) * 0.08, r: 0.5,  color: 'rgba(15, 23, 42, 0.8)' },     // navy
    { cx: 0.5  + Math.sin(t * 1.3) * 0.06, cy: 0.2 + Math.cos(t * 0.7) * 0.05, r: 0.35, color: 'rgba(6, 182, 212, 0.2)' },     // cyan tint
    { cx: 0.6  + Math.cos(t * 1.0) * 0.07, cy: 0.8 + Math.sin(t * 0.6) * 0.04, r: 0.4,  color: 'rgba(139, 92, 246, 0.3)' },    // violet
    { cx: 0.35 + Math.sin(t * 0.5) * 0.05, cy: 0.65 + Math.cos(t * 1.4) * 0.06, r: 0.3, color: 'rgba(16, 185, 129, 0.12)' },   // emerald hint
  ]

  const bgOpacity = interpolate(frame, [0, 40], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: bgOpacity }}>
      {/* Base */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 40%, #0c0015 0%, #030306 60%, #000000 100%)',
      }} />

      {/* Mesh orbs */}
      {orbs.map((orb, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${orb.cx * 100}%`,
          top: `${orb.cy * 100}%`,
          width: orb.r * width,
          height: orb.r * width,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${orb.color} 0%, transparent 70%)`,
          transform: 'translate(-50%, -50%)',
          filter: 'blur(80px)',
          willChange: 'transform',
        }} />
      ))}

      {/* Noise grain overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        opacity: 0.5,
      }} />
    </div>
  )
}

/* ─────────────── PARTICLE FIELD ─────────────── */
const ParticleField = ({ width, height, frame }) => {
  const particles = useMemo(() =>
    Array.from({ length: 80 }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.random() * 2.5,
      speed: 0.15 + Math.random() * 0.35,
      opacity: 0.08 + Math.random() * 0.2,
      phase: Math.random() * Math.PI * 2,
      drift: (Math.random() - 0.5) * 0.3,
    }))
  , [width, height])

  const fieldOpacity = interpolate(frame, [20, 60], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <svg width={width} height={height} style={{ position: 'absolute', inset: 0, opacity: fieldOpacity }}>
      {particles.map((p, i) => {
        const y = (p.y - frame * p.speed * 2 + height * 3) % height
        const x = p.x + Math.sin(frame * 0.02 + p.phase) * 30 * p.drift
        const pulse = Math.sin(frame * 0.04 + p.phase) * 0.5 + 0.5

        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={p.size * (0.6 + pulse * 0.4)}
            fill="white"
            opacity={p.opacity * pulse}
          />
        )
      })}
    </svg>
  )
}

/* ─────────────── LIGHT RAYS ─────────────── */
const LightRays = ({ width, height, frame }) => {
  const rayOpacity = fadeRange(frame, 130, 200, 500, 560)

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: rayOpacity * 0.35, pointerEvents: 'none' }}>
      {/* Central uplighting from macbook */}
      <div style={{
        position: 'absolute',
        left: '50%',
        bottom: '18%',
        width: width * 0.7,
        height: height * 0.6,
        transform: 'translateX(-50%)',
        background: 'conic-gradient(from 250deg at 50% 100%, transparent 0deg, rgba(139, 92, 246, 0.15) 10deg, transparent 30deg, rgba(6, 182, 212, 0.1) 40deg, transparent 60deg, rgba(139, 92, 246, 0.12) 80deg, transparent 100deg, transparent 260deg, rgba(6, 182, 212, 0.08) 280deg, transparent 300deg)',
        filter: 'blur(40px)',
      }} />
    </div>
  )
}

/* ─────────────── SPECTRE LOGO ─────────────── */
const LogoReveal = ({ width, height, frame }) => {
  const opacity = fadeRange(frame, 25, 55, 110, 135)
  const scale = interpolate(
    springIn(frame, 25, { damping: 18, stiffness: 60 }),
    [0, 1], [0.85, 1]
  )
  const blur = interpolate(frame, [25, 50], [12, 0], { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' })
  const yShift = interpolate(
    springIn(frame, 25, { damping: 18, stiffness: 60 }),
    [0, 1], [40, 0]
  )

  return (
    <div style={{
      position: 'absolute',
      inset: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      opacity,
      transform: `scale(${scale}) translateY(${yShift}px)`,
      filter: `blur(${blur}px)`,
    }}>
      {/* Logo image */}
      <Img
        src={staticFile('logo.png')}
        style={{ width: 180, height: 180, marginBottom: 40 }}
      />

      {/* Wordmark */}
      <div style={{
        fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
        fontSize: 96,
        fontWeight: 700,
        color: '#f5f5f7',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}>
        SPECTRE
      </div>

      {/* Subtle glow behind text */}
      <div style={{
        position: 'absolute',
        width: 600,
        height: 200,
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(139, 92, 246, 0.25) 0%, transparent 70%)',
        filter: 'blur(60px)',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: -1,
      }} />
    </div>
  )
}

/* ─────────────── TAGLINE ─────────────── */
const TaglineReveal = ({ frame }) => {
  const text = 'AI-Powered Crypto Intelligence'
  const opacity = fadeRange(frame, 65, 85, 110, 135)

  return (
    <div style={{
      position: 'absolute',
      top: '62%',
      left: '50%',
      transform: 'translateX(-50%)',
      opacity,
    }}>
      <div style={{
        fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
        fontSize: 36,
        fontWeight: 400,
        color: 'rgba(245, 245, 247, 0.7)',
        letterSpacing: '0.06em',
        whiteSpace: 'nowrap',
      }}>
        {text.split('').map((char, i) => {
          const charDelay = 65 + i * 1.2
          const charOpacity = interpolate(frame, [charDelay, charDelay + 8], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
          return (
            <span key={i} style={{ opacity: charOpacity }}>
              {char}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/* ─────────────── MACBOOK PRO FRAME ─────────────── */
const MacBookFrame = ({ width, height, frame, children }) => {
  // MacBook dimensions relative to 4K canvas
  const mbWidth = width * 0.62   // ~2380px at 4K
  const mbHeight = mbWidth * 0.625 // ~1490px  (16" aspect ≈ 16:10 + bezels)
  const bezelTop = 38
  const bezelSide = 18
  const bezelBottom = 44
  const screenW = mbWidth - bezelSide * 2
  const screenH = mbHeight - bezelTop - bezelBottom

  // Entry animation
  const enterProgress = springIn(frame, 130, { damping: 16, stiffness: 50, mass: 1.2 })
  const yOffset = interpolate(enterProgress, [0, 1], [height * 0.5, 0])
  const mbScale = interpolate(enterProgress, [0, 1], [0.9, 1])

  // Slight perspective tilt during entrance
  const rotateX = interpolate(enterProgress, [0, 0.6, 1], [12, 3, 0])

  // Zoom pull-back in Act 3
  const pullBack = frame > 390
    ? interpolate(frame, [390, 460], [1, 0.88], { extrapolateRight: 'clamp' })
    : 1

  // Screen glow reveal
  const screenOpacity = interpolate(frame, [185, 220], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  // Hide MacBook entirely before entrance starts
  const mbOpacity = frame < 130 ? 0 : interpolate(enterProgress, [0, 0.15], [0, 1], { extrapolateRight: 'clamp' })

  return (
    <div style={{
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: mbWidth,
      height: mbHeight,
      transform: `translate(-50%, -50%) translateY(${yOffset}px) scale(${mbScale * pullBack}) perspective(2000px) rotateX(${rotateX}deg)`,
      transformOrigin: 'center center',
      opacity: mbOpacity,
    }}>
      {/* Lid / screen housing */}
      <div style={{
        width: '100%',
        height: '100%',
        borderRadius: 20,
        background: 'linear-gradient(180deg, #2a2a2c 0%, #1a1a1c 50%, #1d1d1f 100%)',
        boxShadow: `
          0 60px 120px rgba(0,0,0,0.7),
          0 30px 60px rgba(0,0,0,0.5),
          0 0 120px rgba(139, 92, 246, 0.08),
          inset 0 1px 0 rgba(255,255,255,0.08)
        `,
        padding: `${bezelTop}px ${bezelSide}px ${bezelBottom}px`,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Notch */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 200,
          height: 28,
          background: '#1a1a1c',
          borderRadius: '0 0 14 14',
          zIndex: 5,
        }} />

        {/* Camera dot in notch */}
        <div style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: '#0a0a0a',
          border: '1px solid #333',
          zIndex: 6,
        }} />

        {/* Screen area */}
        <div style={{
          width: screenW,
          height: screenH,
          borderRadius: 8,
          overflow: 'hidden',
          background: '#09090b',
          position: 'relative',
          opacity: screenOpacity,
        }}>
          {/* Screen content (platform screenshot) */}
          {children || (
            <Img
              src={staticFile('video-promo/platform-full.png')}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                objectPosition: 'top center',
              }}
            />
          )}

          {/* Screen glare */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, transparent 40%, transparent 60%, rgba(255,255,255,0.02) 100%)',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Bottom bezel text */}
        <div style={{
          position: 'absolute',
          bottom: 14,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: "'SF Pro Display', -apple-system, system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 500,
          color: 'rgba(255,255,255,0.15)',
          letterSpacing: '0.04em',
        }}>
          MacBook Pro
        </div>
      </div>

      {/* Base / hinge */}
      <div style={{
        width: '104%',
        height: 12,
        marginLeft: '-2%',
        background: 'linear-gradient(180deg, #3a3a3c 0%, #2a2a2c 40%, #1d1d1f 100%)',
        borderRadius: '0 0 6px 6px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
      }} />

      {/* Base shadow on surface */}
      <div style={{
        width: '95%',
        height: 6,
        margin: '0 auto',
        background: 'radial-gradient(ellipse, rgba(0,0,0,0.4) 0%, transparent 70%)',
        borderRadius: '50%',
      }} />
    </div>
  )
}

/* ─────────────── FLOATING UI ELEMENTS ─────────────── */
const FloatingCard = ({ frame, delay, x, y, width: cardW, height: cardH, rotation, children, glowColor = 'rgba(139, 92, 246, 0.15)' }) => {
  const enter = springIn(frame, delay, { damping: 12, stiffness: 60, mass: 0.9 })
  const scale = interpolate(enter, [0, 1], [0.6, 1])
  const opacity = interpolate(enter, [0, 0.3, 1], [0, 0.8, 1])
  const yShift = interpolate(enter, [0, 1], [80, 0])

  // Gentle floating after entry
  const floatY = frame > delay + 30
    ? Math.sin((frame - delay) * 0.03) * 8
    : 0

  // Fade out in Act 3
  const fadeOut = frame > 420
    ? interpolate(frame, [420, 470], [1, 0], { extrapolateRight: 'clamp' })
    : 1

  return (
    <div style={{
      position: 'absolute',
      left: x,
      top: y,
      width: cardW,
      height: cardH,
      transform: `scale(${scale}) translateY(${yShift + floatY}px) rotate(${rotation || 0}deg)`,
      opacity: opacity * fadeOut,
      transformOrigin: 'center center',
    }}>
      <div style={{
        width: '100%',
        height: '100%',
        borderRadius: 20,
        background: 'rgba(18, 18, 22, 0.85)',
        backdropFilter: 'blur(24px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: `
          0 20px 60px rgba(0,0,0,0.5),
          0 0 40px ${glowColor},
          inset 0 1px 0 rgba(255,255,255,0.06)
        `,
        padding: 28,
        overflow: 'hidden',
      }}>
        {children}
      </div>
    </div>
  )
}

/* ─── Individual floating elements ─── */

const PriceCard = ({ frame }) => (
  <FloatingCard
    frame={frame} delay={225}
    x="3%" y="18%" width={380} height={200}
    rotation={-4}
    glowColor="rgba(16, 185, 129, 0.12)"
  >
    <div style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 42, height: 42, borderRadius: '50%',
          background: 'linear-gradient(135deg, #F7931A, #F7931A88)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#fff',
        }}>BTC</div>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600, color: '#f5f5f7' }}>Bitcoin</div>
          <div style={{ fontSize: 13, color: 'rgba(245,245,247,0.5)' }}>BTC/USD</div>
        </div>
      </div>
      <div style={{ fontSize: 38, fontWeight: 700, color: '#f5f5f7', marginBottom: 6 }}>
        $97,842
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#10b981' }}>
        +2.54%
      </div>
    </div>
  </FloatingCard>
)

const SentimentCard = ({ frame }) => (
  <FloatingCard
    frame={frame} delay={250}
    x="76%" y="14%" width={340} height={190}
    rotation={3}
    glowColor="rgba(6, 182, 212, 0.12)"
  >
    <div style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'rgba(245,245,247,0.5)', marginBottom: 14, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Market Sentiment
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <div style={{ fontSize: 52, fontWeight: 700, color: '#22c55e' }}>72</div>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#22c55e' }}>Greed</div>
      </div>
      <div style={{
        width: '100%', height: 6, borderRadius: 3, marginTop: 16,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
      }}>
        <div style={{
          width: '72%', height: '100%', borderRadius: 3,
          background: 'linear-gradient(90deg, #ef4444, #eab308, #22c55e)',
        }} />
      </div>
    </div>
  </FloatingCard>
)

const AiBriefCard = ({ frame }) => (
  <FloatingCard
    frame={frame} delay={270}
    x="1%" y="60%" width={400} height={180}
    rotation={2}
    glowColor="rgba(139, 92, 246, 0.15)"
  >
    <div style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: '#fff',
        }}>AI</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: '#f5f5f7' }}>Daily AI Brief</div>
      </div>
      <div style={{ fontSize: 15, lineHeight: 1.5, color: 'rgba(245,245,247,0.65)' }}>
        "Bitcoin broke through the $97K level with strong volume, signaling renewed institutional interest..."
      </div>
    </div>
  </FloatingCard>
)

const WatchlistCard = ({ frame }) => (
  <FloatingCard
    frame={frame} delay={240}
    x="78%" y="55%" width={320} height={220}
    rotation={-2}
    glowColor="rgba(245, 158, 11, 0.1)"
  >
    <div style={{ fontFamily: "'SF Pro Display', system-ui, sans-serif" }}>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'rgba(245,245,247,0.5)', marginBottom: 16, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
        Watchlist
      </div>
      {[
        { sym: 'ETH', price: '$3,421', change: '+3.2%', bull: true, color: '#627EEA' },
        { sym: 'SOL', price: '$196.4', change: '-1.8%', bull: false, color: '#00FFA3' },
        { sym: 'XRP', price: '$2.45', change: '+5.4%', bull: true, color: '#00AAE4' },
      ].map((t, i) => (
        <div key={t.sym} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 0',
          borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.04)' : 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: `linear-gradient(135deg, ${t.color}, ${t.color}88)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 9, fontWeight: 800, color: '#fff',
            }}>{t.sym.slice(0, 2)}</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f5f5f7' }}>{t.sym}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f5f5f7' }}>{t.price}</div>
            <div style={{ fontSize: 12, fontWeight: 500, color: t.bull ? '#10b981' : '#ef4444' }}>{t.change}</div>
          </div>
        </div>
      ))}
    </div>
  </FloatingCard>
)

/* ─────────────── FEATURE CALLOUTS ─────────────── */
const FeatureCallouts = ({ frame }) => {
  const features = [
    { text: 'Real-Time Market Data', delay: 285 },
    { text: 'AI-Powered Insights', delay: 305 },
    { text: 'Smart Watchlists', delay: 325 },
  ]

  // Fade out with cards
  const fadeOut = frame > 420
    ? interpolate(frame, [420, 470], [1, 0], { extrapolateRight: 'clamp' })
    : 1

  return (
    <div style={{
      position: 'absolute',
      bottom: '6%',
      left: 0, right: 0,
      display: 'flex',
      justifyContent: 'center',
      gap: 60,
      opacity: fadeOut,
    }}>
      {features.map((f, i) => {
        const enter = springIn(frame, f.delay, { damping: 15, stiffness: 70 })
        const opacity = interpolate(enter, [0, 1], [0, 1])
        const yShift = interpolate(enter, [0, 1], [30, 0])

        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            opacity,
            transform: `translateY(${yShift}px)`,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
              boxShadow: '0 0 12px rgba(139, 92, 246, 0.5)',
            }} />
            <div style={{
              fontFamily: "'SF Pro Display', system-ui, sans-serif",
              fontSize: 22,
              fontWeight: 500,
              color: 'rgba(245, 245, 247, 0.7)',
              letterSpacing: '0.02em',
            }}>
              {f.text}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ─────────────── CTA / FINALE ─────────────── */
const CtaReveal = ({ frame, width }) => {
  const opacity = fadeRange(frame, 445, 475, 580, 600)
  const scale = interpolate(
    springIn(frame, 445, { damping: 18, stiffness: 55 }),
    [0, 1], [0.9, 1]
  )
  const blur = interpolate(frame, [445, 465], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

  return (
    <div style={{
      position: 'absolute',
      bottom: '6%',
      left: 0, right: 0,
      textAlign: 'center',
      opacity,
      transform: `scale(${scale})`,
      filter: `blur(${blur}px)`,
    }}>
      <div style={{
        fontFamily: "'SF Pro Display', system-ui, sans-serif",
        fontSize: 28,
        fontWeight: 500,
        color: 'rgba(245, 245, 247, 0.6)',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: 20,
      }}>
        The Future of Crypto Research
      </div>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 14,
        padding: '16px 40px',
        borderRadius: 50,
        background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2), rgba(6, 182, 212, 0.15))',
        border: '1px solid rgba(139, 92, 246, 0.3)',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 0 40px rgba(139, 92, 246, 0.15)',
      }}>
        <div style={{
          fontFamily: "'SF Pro Display', system-ui, sans-serif",
          fontSize: 22,
          fontWeight: 600,
          color: '#f5f5f7',
          letterSpacing: '0.04em',
        }}>
          spectre.app
        </div>
      </div>
    </div>
  )
}

/* ─────────────── FLASH EFFECT ─────────────── */
const FlashEffect = ({ frame }) => {
  const flashOpacity = frame >= 510 && frame <= 520
    ? interpolate(frame, [510, 514, 520], [0, 0.15, 0], { extrapolateRight: 'clamp' })
    : 0

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'white',
      opacity: flashOpacity,
      pointerEvents: 'none',
      zIndex: 100,
    }} />
  )
}

/* ─────────────── MAIN COMPOSITION ─────────────── */
export const SpectreShowcase = () => {
  const frame = useCurrentFrame()
  const { width, height } = useVideoConfig()

  return (
    <div style={{
      width,
      height,
      background: '#000000',
      position: 'relative',
      overflow: 'hidden',
      fontFamily: "'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Inter', system-ui, sans-serif",
    }}>
      {/* Layer 0 - Animated mesh gradient */}
      <MeshGradientBg width={width} height={height} frame={frame} />

      {/* Layer 1 - Particle field */}
      <ParticleField width={width} height={height} frame={frame} />

      {/* Layer 2 - Light rays from MacBook */}
      <LightRays width={width} height={height} frame={frame} />

      {/* Layer 3 - Logo + tagline (Act 1) */}
      <LogoReveal width={width} height={height} frame={frame} />
      <TaglineReveal frame={frame} />

      {/* Layer 4 - MacBook Pro frame (Act 2+) */}
      <MacBookFrame width={width} height={height} frame={frame} />

      {/* Layer 5 - Floating UI cards (Act 2) */}
      <PriceCard frame={frame} />
      <SentimentCard frame={frame} />
      <AiBriefCard frame={frame} />
      <WatchlistCard frame={frame} />

      {/* Layer 6 - Feature callouts (Act 2) */}
      <FeatureCallouts frame={frame} />

      {/* Layer 7 - CTA (Act 3) */}
      <CtaReveal frame={frame} width={width} />

      {/* Layer 8 - Flash transition */}
      <FlashEffect frame={frame} />
    </div>
  )
}

export default SpectreShowcase
