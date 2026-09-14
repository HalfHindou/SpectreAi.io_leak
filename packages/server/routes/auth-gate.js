// Team password gate - Express dev parity of apps/*/api/auth-gate.js.
// The password lives only in env (TEAM_GATE_PASSWORD). Clients POST the
// candidate, we timingSafeEqual it and return 200 { ok } or 401.

const express = require('express')
const crypto = require('crypto')

const router = express.Router()

router.post('/', (req, res) => {
  const expected = process.env.TEAM_GATE_PASSWORD
  if (!expected) return res.status(503).json({ error: 'Gate not configured' })

  const candidate = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!candidate) return res.status(400).json({ error: 'Missing password' })

  const a = Buffer.from(candidate)
  const b = Buffer.from(expected)
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b)
  if (!ok) return res.status(401).json({ error: 'Invalid password' })

  return res.status(200).json({ ok: true })
})

module.exports = router
