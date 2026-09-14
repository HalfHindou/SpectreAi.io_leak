import { createContext, useContext } from 'react'

/** When true, the app is shown inside the iPhone mobile preview frame (forces mobile layout). */
export const MobilePreviewContext = createContext(false)

export function useMobilePreview() {
  return useContext(MobilePreviewContext)
}
