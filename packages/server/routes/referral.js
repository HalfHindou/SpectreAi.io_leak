/**
 * Referral Code Routes (Express - dev only; prod runs the Vercel serverless
 * handlers under each app's api directory).
 *
 * POST /api/referral/apply  - apply a referral code (authenticated)
 * GET  /api/referral/code   - get the authenticated user's own code
 * GET  /api/referral/stats  - get authenticated user's referral stats
 *
 * Codes are random base32 (Crockford-style, no 0/1/I/L/O/U), NOT derived
 * from userId. The userId always comes from the verified Privy JWT - never
 * from a path param or body.
 */
const express = require('express')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { verifyPrivyToken } = require('../lib/auth')

const router = express.Router()

const DATA_DIR = path.resolve(__dirname, '..', 'data')
const REFERRALS_FILE = path.join(DATA_DIR, 'referrals.json')

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
}

const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'
const REFERRAL_CODE_LEN = 8
const REFERRAL_CODE_RE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/

function isValidReferralCode(code) {
  return typeof code === 'string' && REFERRAL_CODE_RE.test(code)
}

function newReferralCode() {
  const buf = crypto.randomBytes(REFERRAL_CODE_LEN)
  let s = ''
  for (let i = 0; i < REFERRAL_CODE_LEN; i++) {
    s += REFERRAL_CODE_ALPHABET[buf[i] % REFERRAL_CODE_ALPHABET.length]
  }
  return s
}

function loadData() {
  try {
    if (fs.existsSync(REFERRALS_FILE)) {
      const data = JSON.parse(fs.readFileSync(REFERRALS_FILE, 'utf8'))
      // Backfill new fields on older data shapes.
      if (!data.codes) data.codes = {}        // userId -> { code, createdAt }
      if (!data.owners) data.owners = {}      // code -> { userId, createdAt }
      if (!data.referrals) data.referrals = []
      return data
    }
  } catch (e) {
    console.error('[referral] Failed to load referrals:', e.message)
  }
  return { codes: {}, owners: {}, referrals: [] }
}

function saveData(data) {
  fs.writeFileSync(REFERRALS_FILE, JSON.stringify(data, null, 2), 'utf8')
}

function getOrCreateUserReferralCode(userId, data) {
  const existing = data.codes[userId]
  if (existing?.code) return existing.code
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newReferralCode()
    if (!data.owners[code]) {
      const createdAt = new Date().toISOString()
      data.codes[userId] = { code, createdAt }
      data.owners[code] = { userId, createdAt }
      return code
    }
  }
  throw new Error('referral code generation failed')
}

router.post('/apply', async (req, res) => {
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const raw = req.body?.code
  if (typeof raw !== 'string' || raw.length > 16) {
    return res.status(400).json({ error: 'code required' })
  }
  const code = raw.toUpperCase().trim()
  if (!isValidReferralCode(code)) {
    // 400 reserved for malformed shape only. Existence is opaque past here.
    return res.status(400).json({ error: 'Invalid referral code' })
  }

  const data = loadData()

  if (data.referrals.some(r => r.userId === userId)) {
    return res.status(409).json({ error: 'User already has a referral' })
  }

  // Collapse "code not found" and "code is yours" into one identical
  // response so a fresh-signup attacker can't fingerprint code ownership.
  const ownerEntry = data.owners[code]
  if (!ownerEntry || ownerEntry.userId === userId) {
    return res.status(404).json({ error: 'Referral code not found' })
  }

  data.referrals.push({
    userId,
    referrerCode: code,
    appliedAt: new Date().toISOString(),
  })
  saveData(data)
  res.json({ success: true })
})

router.get('/code', async (req, res) => {
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const data = loadData()
    const code = getOrCreateUserReferralCode(userId, data)
    saveData(data)
    const referredCount = data.referrals.filter(r => r.referrerCode === code).length
    res.json({ code, referredCount })
  } catch (err) {
    console.error('[referral/code] error:', err.message)
    res.status(503).json({ error: 'Referral code unavailable' })
  }
})

router.get('/stats', async (req, res) => {
  const userId = await verifyPrivyToken(req)
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const data = loadData()
    const code = getOrCreateUserReferralCode(userId, data)
    saveData(data)
    const referred = data.referrals.filter(r => r.referrerCode === code)
    res.json({
      code,
      referredCount: referred.length,
      // Drop per-referral userId. Pre-fix slice(0, 12) leaked exactly 2
      // chars (every Privy DID prefix is 'did:privy:cm') — theater that
      // looked like effort. Aggregate count + dates is enough.
      referrals: referred.map(r => ({ appliedAt: r.appliedAt })),
    })
  } catch (err) {
    console.error('[referral/stats] error:', err.message)
    res.status(503).json({ error: 'Referral stats unavailable' })
  }
})

module.exports = router
