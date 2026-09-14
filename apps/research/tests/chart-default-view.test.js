import { describe, expect, it } from 'vitest'
import { getDefaultChartZoom, hasCustomChartView } from '../src/lib/chart-default-view'
const now = Date.UTC(2026, 8, 10, 18)
const bars = hours => Array.from({length:hours*12}, (_, i) => ({date:new Date(now-(hours*12-1-i)*300000)}))
describe('Chart reset restores the selected range', () => {
  it('shows 24h of a four-day buffer without deleting older bars', () => {
    const data=bars(96)
    expect(getDefaultChartZoom(data,'1D',false,now)).toBeCloseTo(data.length/289)
    expect(data).toHaveLength(1152)
  })
  it('counts actual stock bars in the last day rather than 288 trading bars across days', () => {
    const data=bars(120).filter(b => {const h=b.date.getUTCHours();return h>=13 && h<20})
    const within=data.filter(b=>b.date.getTime()>=now-86400000)
    expect(getDefaultChartZoom(data,'1D',false,now)).toBeCloseTo(data.length/within.length)
  })
  it('keeps complete-history and line-only defaults intact', () => {
    expect(getDefaultChartZoom(bars(96),'ALL',false,now)).toBe(1)
    expect(getDefaultChartZoom(bars(96),'YTD',false,now)).toBe(1)
    expect(getDefaultChartZoom(bars(96),'24H',true,now)).toBe(1)
  })
  it('distinguishes a custom view from normal initial zoom and small rounding changes', () => {
    expect(hasCustomChartView(4,4,0)).toBe(false)
    expect(hasCustomChartView(4.001,4,0)).toBe(false)
    expect(hasCustomChartView(0.5,4,0)).toBe(true)
    expect(hasCustomChartView(4,4,15)).toBe(true)
  })
  it('handles missing bars and preserves the sparse-data readability floor', () => {
    expect(getDefaultChartZoom([], '1D',false,now)).toBe(1)
    const data=bars(96).filter((b,i)=>i<100||i>1150-4)
    expect(Number.isFinite(getDefaultChartZoom(data,'1D',false,now))).toBe(true)
  })
})
