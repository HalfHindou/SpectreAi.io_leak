/**
 * MobileDataTabs — mounts the full desktop DataTabs.
 *
 * Per user request: same functionality as desktop, no stripped-down
 * mobile-native version. The transactions table keeps all 7 columns
 * (Age, Type, Price, Amount, ETH, USD, Maker) and scrolls horizontally
 * inside its wrapper. Holders/Analytics tabs stay locked as on desktop.
 */
import React from 'react'
import DataTabs from '../DataTabs'
import './MobileDataTabs.css'

export default function MobileDataTabs({ token, registerRefresh }) {
  return (
    <section className="mdt" aria-label="Token activity">
      <DataTabs token={token} isExpanded={false} setIsExpanded={() => {}} registerRefresh={registerRefresh} />
    </section>
  )
}
