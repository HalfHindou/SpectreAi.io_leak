/**
 * Crypto Memory Game – match pairs of token logos (flip to uncover).
 */
import React, { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import './crypto-memory-game.css'

const MEMORY_COINS = [
  { symbol: 'SPECTRE', logo: '/round-logo.png' },
  { symbol: 'BTC', logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png' },
  { symbol: 'ETH', logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png' },
  { symbol: 'SOL', logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png' },
  { symbol: 'PEPE', logo: 'https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg' },
  { symbol: 'ARB', logo: 'https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg' },
  { symbol: 'LINK', logo: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png' },
  { symbol: 'UNI', logo: 'https://assets.coingecko.com/coins/images/12504/small/uni.jpg' },
]

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function buildDeck() {
  const pairs = MEMORY_COINS.flatMap((c) => [
    { id: `${c.symbol}-a`, symbol: c.symbol, logo: c.logo },
    { id: `${c.symbol}-b`, symbol: c.symbol, logo: c.logo },
  ])
  return shuffle(pairs)
}

export default function CryptoMemoryGame({ onClose }) {
  const { t } = useTranslation()
  const [deck, setDeck] = useState(buildDeck)

  const [flipped, setFlipped] = useState(new Set())
  const [matched, setMatched] = useState(new Set())
  const [lock, setLock] = useState(false)

  const handleCardClick = (index) => {
    if (lock || flipped.has(index) || matched.has(index)) return
    const next = new Set(flipped)
    next.add(index)
    setFlipped(next)
    if (next.size < 2) return
    setLock(true)
    const [a, b] = [...next]
    if (deck[a].symbol === deck[b].symbol) {
      setMatched((m) => new Set([...m, a, b]))
      setFlipped(new Set())
      setLock(false)
    } else {
      setTimeout(() => {
        setFlipped(new Set())
        setLock(false)
      }, 800)
    }
  }

  const pairsCount = MEMORY_COINS.length
  const won = matched.size === pairsCount * 2

  const restart = useCallback(() => {
    setDeck(buildDeck())
    setFlipped(new Set())
    setMatched(new Set())
  }, [])

  return (
    <div className="crypto-memory-overlay" onClick={(e) => e.target.classList.contains('crypto-memory-overlay') && onClose?.()}>
      <div className="crypto-memory-modal">
        <div className="crypto-memory-header">
          <h2 className="crypto-memory-title">{t('cryptoMemory.title')}</h2>
          <button type="button" className="crypto-memory-close" onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        {won ? (
          <div className="crypto-memory-won">
            <p className="crypto-memory-congrats">{t('cryptoMemory.congrats')}</p>
            <p className="crypto-memory-points">{t('cryptoMemory.points')}</p>
            <button type="button" className="crypto-memory-restart" onClick={restart}>{t('cryptoMemory.playAgain')}</button>
          </div>
        ) : (
          <div className="crypto-memory-grid">
            {deck.map((card, index) => (
              <button
                key={card.id}
                type="button"
                className={`crypto-memory-card ${flipped.has(index) || matched.has(index) ? 'flipped' : ''} ${matched.has(index) ? 'matched' : ''}`}
                onClick={() => handleCardClick(index)}
                disabled={lock}
              >
                <div className="crypto-memory-card-inner">
                  <div className="crypto-memory-card-back">?</div>
                  <div className="crypto-memory-card-front">
                    {card.logo ? (
                      <img src={card.logo} alt={card.symbol} />
                    ) : (
                      <span>{card.symbol}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
