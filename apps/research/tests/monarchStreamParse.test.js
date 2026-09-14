/**
 * parseSseFrames — the frame splitter behind every /api/monarch/chat consumer
 * (RZ agent, X Dash forensics + GTM, the You "Ask Spectre" widget). It used to
 * live as three near-identical private copies; these tests pin the behavior now
 * that one shared implementation serves all of them.
 */
import { describe, it, expect } from 'vitest'
import { parseSseFrames } from '@/lib/monarch-stream'

describe('parseSseFrames', () => {
  it('splits complete frames and keeps the unconsumed tail', () => {
    const { frames, tail } = parseSseFrames('data: {"type":"text","content":"hi"}\n\ndata: {"typ')
    expect(frames).toEqual(['{"type":"text","content":"hi"}'])
    expect(tail).toBe('data: {"typ')
  })

  it('reassembles a frame split across two chunks', () => {
    const first = parseSseFrames('data: {"type":"te')
    expect(first.frames).toEqual([])
    const second = parseSseFrames(first.tail + 'xt","content":"ok"}\n\n')
    expect(second.frames).toEqual(['{"type":"text","content":"ok"}'])
    expect(second.tail).toBe('')
  })

  it('skips heartbeat comment lines without emitting a frame', () => {
    const { frames, tail } = parseSseFrames(':heartbeat\n\n')
    expect(frames).toEqual([])
    expect(tail).toBe('')
  })

  it('keeps a real payload that shares a frame with a comment line', () => {
    const { frames } = parseSseFrames(':heartbeat\ndata: {"type":"meta"}\n\n')
    expect(frames).toEqual(['{"type":"meta"}'])
  })

  it('accepts "data:" with no space after the colon', () => {
    const { frames } = parseSseFrames('data:{"type":"text","content":"x"}\n\n')
    expect(frames).toEqual(['{"type":"text","content":"x"}'])
  })

  it('joins multi-line data payloads with a newline', () => {
    const { frames } = parseSseFrames('data: line one\ndata: line two\n\n')
    expect(frames).toEqual(['line one\nline two'])
  })

  it('surfaces the [DONE] terminator as an ordinary frame', () => {
    const { frames } = parseSseFrames('data: {"type":"text","content":"a"}\n\ndata: [DONE]\n\n')
    expect(frames).toEqual(['{"type":"text","content":"a"}', '[DONE]'])
  })

  it('emits several frames arriving in one chunk', () => {
    const chunk = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c":3}\n\n'
    expect(parseSseFrames(chunk).frames).toHaveLength(3)
  })

  it('returns an empty result for an empty buffer', () => {
    expect(parseSseFrames('')).toEqual({ frames: [], tail: '' })
  })
})
