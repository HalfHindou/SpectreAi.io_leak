/**
 * privy-provider-eager — the OLD behaviour, behind a kill switch.
 *
 * When VITE_PRIVY_EAGER === '1', main.jsx dynamic-imports THIS module before
 * createRoot and wraps the app in the real PrivyProvider synchronously (the
 * pre-lazy-mount behaviour). Because it is only ever reached via a dynamic import
 * gated on that env flag, its static @privy-io imports never land on the normal
 * boot path — the flag build pulls the provider chunk, the default build does not.
 *
 * Use only to A/B the lazy-mount against the eager mount, or as an emergency
 * fallback if the sibling-provider architecture ever regresses in prod.
 */
import React from 'react'
import { PrivyProvider } from '@privy-io/react-auth'
import { privyConfig } from './privy-config'
import { PRIVY_APP_ID, PRIVY_CLIENT_ID } from './privy-app-id'
import { applyPrivyModalHacks } from './privy-modal-hacks'

applyPrivyModalHacks()

export default function EagerPrivyProvider({ children }) {
  if (!PRIVY_APP_ID) return children
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      {...(PRIVY_CLIENT_ID ? { clientId: PRIVY_CLIENT_ID } : {})}
      config={privyConfig}
    >
      {children}
    </PrivyProvider>
  )
}
