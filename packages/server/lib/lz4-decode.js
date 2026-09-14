/**
 * lz4-decode.js — dependency-free LZ4 frame decoder.
 *
 * Exists because Hyperliquid publishes its public builder-fill archive as
 * `.csv.lz4` (LZ4 frame format) and nothing in this monorepo could read it.
 * Adding a native lz4 binding would not survive a Vercel serverless bundle, so
 * this is a pure-JS reader: frame header parse + block decode, no checksums
 * verified (we only ever read a public archive over TLS).
 *
 * Spec: https://github.com/lz4/lz4/blob/dev/doc/lz4_Frame_format.md
 *
 * Supports: linked and independent blocks, block checksums (skipped),
 * content size, content checksum (skipped), skippable frames, and raw
 * concatenated frames. Legacy (0x184C2102) frames are NOT supported — the
 * archive does not use them.
 */

'use strict'

const MAGIC = 0x184d2204
const SKIPPABLE_LO = 0x184d2a50
const SKIPPABLE_HI = 0x184d2a5f

/**
 * Decode one LZ4 block into `out` starting at `outPos`.
 * Returns the new output position.
 *
 * The match-copy is deliberately byte-at-a-time: LZ4 allows the match to
 * overlap the region it is writing (offset 1 = run-length encoding), so a
 * bulk copy would read bytes that have not been produced yet.
 */
function decodeBlock(src, sStart, sEnd, out, outPos) {
  let s = sStart
  let o = outPos

  while (s < sEnd) {
    const token = src[s++]

    // ---- literals ----
    let litLen = token >>> 4
    if (litLen === 15) {
      let b
      do {
        if (s >= sEnd) throw new Error('lz4: truncated literal length')
        b = src[s++]
        litLen += b
      } while (b === 255)
    }
    if (litLen > 0) {
      const end = s + litLen
      if (end > sEnd) throw new Error('lz4: literal run overruns block')
      src.copy(out, o, s, end)
      o += litLen
      s = end
    }

    // The last sequence in a block is literals-only and has no match.
    if (s >= sEnd) break

    // ---- match ----
    if (s + 1 >= sEnd) throw new Error('lz4: truncated match offset')
    const offset = src[s] | (src[s + 1] << 8)
    s += 2
    if (offset === 0) throw new Error('lz4: zero match offset')

    let matchLen = token & 0x0f
    if (matchLen === 15) {
      let b
      do {
        if (s >= sEnd) throw new Error('lz4: truncated match length')
        b = src[s++]
        matchLen += b
      } while (b === 255)
    }
    matchLen += 4 // minmatch

    let m = o - offset
    if (m < 0) throw new Error('lz4: match offset before output start')
    for (let i = 0; i < matchLen; i++) out[o++] = out[m++]
  }

  return o
}

/**
 * Decompress an LZ4 frame (or a run of concatenated frames) to a Buffer.
 * @param {Buffer} input
 * @returns {Buffer}
 */
function lz4Decode(input) {
  if (!Buffer.isBuffer(input)) input = Buffer.from(input)
  const chunks = []
  let p = 0

  while (p + 4 <= input.length) {
    const magic = input.readUInt32LE(p)
    p += 4

    if (magic >= SKIPPABLE_LO && magic <= SKIPPABLE_HI) {
      const size = input.readUInt32LE(p)
      p += 4 + size
      continue
    }
    if (magic !== MAGIC) throw new Error(`lz4: bad magic 0x${magic.toString(16)}`)

    // ---- frame descriptor ----
    const flg = input[p++]
    const bd = input[p++]
    const version = flg >>> 6
    if (version !== 1) throw new Error(`lz4: unsupported frame version ${version}`)
    const blockChecksum = (flg & 0x10) !== 0
    const hasContentSize = (flg & 0x08) !== 0
    const contentChecksum = (flg & 0x04) !== 0
    const hasDictId = (flg & 0x01) !== 0

    let declaredSize = null
    if (hasContentSize) {
      declaredSize = Number(input.readBigUInt64LE(p))
      p += 8
    }
    if (hasDictId) p += 4
    p += 1 // header checksum byte

    // Max block size lives in BD bits 6-4: 4=64KB, 5=256KB, 6=1MB, 7=4MB.
    const bdBits = (bd >>> 4) & 0x07
    const maxBlock = bdBits >= 4 ? 1 << (2 * bdBits + 8) : 1 << 16

    // Output buffer. When the frame declares its size we can allocate exactly;
    // otherwise grow geometrically. Linked blocks reference earlier output, so
    // one contiguous buffer per frame is required (never per-block buffers).
    let cap = declaredSize != null ? declaredSize : Math.max(maxBlock * 4, input.length * 4, 1 << 16)
    let out = Buffer.allocUnsafe(cap)
    let o = 0

    for (;;) {
      if (p + 4 > input.length) throw new Error('lz4: truncated block header')
      const raw = input.readUInt32LE(p)
      p += 4
      if (raw === 0) break // EndMark

      const uncompressed = (raw & 0x80000000) !== 0
      const blockSize = raw & 0x7fffffff
      if (p + blockSize > input.length) throw new Error('lz4: truncated block body')

      // Worst case a block expands to maxBlock; keep that much headroom.
      if (o + maxBlock > cap) {
        cap = Math.max(cap * 2, o + maxBlock)
        const grown = Buffer.allocUnsafe(cap)
        out.copy(grown, 0, 0, o)
        out = grown
      }

      if (uncompressed) {
        input.copy(out, o, p, p + blockSize)
        o += blockSize
      } else {
        o = decodeBlock(input, p, p + blockSize, out, o)
      }

      p += blockSize
      if (blockChecksum) p += 4
    }

    if (contentChecksum) p += 4
    chunks.push(out.subarray(0, o))
  }

  if (chunks.length === 1) return chunks[0]
  return Buffer.concat(chunks)
}

module.exports = { lz4Decode }
