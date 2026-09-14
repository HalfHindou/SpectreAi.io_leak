/**
 * Jupiter fee-account derivation test (2026-07-06 audit).
 *
 * Locks in the ATA math used by resolveJupiterFeeAccount in the swap
 * handlers: fee wallet + mint -> associated token account. Verified against
 * @solana/spl-token's getAssociatedTokenAddressSync and the on-chain
 * account 2026-07-06. Passing a raw WALLET address to Jupiter silently
 * drops the platform fee (the wallet key is absent from the built tx) -
 * only an initialized ATA collects.
 */
import { describe, it, expect } from 'vitest'
import { PublicKey } from '@solana/web3.js'
import { getAssociatedTokenAddressSync } from '@solana/spl-token'

const SPL_TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
const SPL_ATA_PROGRAM_ID = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const WALLET = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9'

// Mirrors the derivation inside resolveJupiterFeeAccount (apps/trading/api/swap.js,
// apps/research/api/_lib/handlers/swap.js, packages/server/routes/swap.js).
function deriveFeeAta(feeWallet, mint) {
  const [ata] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(feeWallet).toBuffer(),
      new PublicKey(SPL_TOKEN_PROGRAM_ID).toBuffer(),
      new PublicKey(mint).toBuffer(),
    ],
    new PublicKey(SPL_ATA_PROGRAM_ID),
  )
  return ata
}

describe('Jupiter fee ATA derivation', () => {
  it('matches @solana/spl-token canonical ATA derivation', () => {
    const hand = deriveFeeAta(WALLET, USDC)
    const canonical = getAssociatedTokenAddressSync(new PublicKey(USDC), new PublicKey(WALLET))
    expect(hand.equals(canonical)).toBe(true)
    // pinned regression value (verified initialized on-chain 2026-07-06)
    expect(hand.toBase58()).toBe('FzbcyEZ9m8xjtergWgWDq7mfPoHEbboBF791B6cTpzbq')
  })

  it('derives distinct ATAs per mint', () => {
    const WSOL = 'So11111111111111111111111111111111111111112'
    expect(deriveFeeAta(WALLET, USDC).equals(deriveFeeAta(WALLET, WSOL))).toBe(false)
  })

  it('the ATA is never the wallet itself (the silently-dropped-fee bug shape)', () => {
    expect(deriveFeeAta(WALLET, USDC).toBase58()).not.toBe(WALLET)
  })
})
