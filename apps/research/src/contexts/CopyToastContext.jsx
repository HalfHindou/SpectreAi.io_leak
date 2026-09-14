import { createContext, useContext, useState, useCallback, useMemo } from 'react'

const CopyToastContext = createContext()

export const useCopyToast = () => useContext(CopyToastContext)

export function CopyToastProvider({ children }) {
  const [showCopyToast, setShowCopyToast] = useState(false)
  const [copyToastMessage, setCopyToastMessage] = useState('CA copied to clipboard')
  // 2026-05-23: variant supports 'default' (green success, the original) and
  // 'destructive' (red, for unlink-account / delete-resource actions). The
  // toast component reads copyToastVariant and applies a matching CSS class.
  const [copyToastVariant, setCopyToastVariant] = useState('default')

  const triggerCopyToast = useCallback((message = 'CA copied to clipboard', options) => {
    const variant = options?.variant === 'destructive' ? 'destructive' : 'default'
    setCopyToastMessage(message)
    setCopyToastVariant(variant)
    setShowCopyToast(true)
    setTimeout(() => setShowCopyToast(false), 2000)
  }, [])

  // Memoize so consumers don't re-render when an ancestor re-renders without a
  // toast state change (the value object would otherwise be recreated each time).
  const value = useMemo(
    () => ({ triggerCopyToast, showCopyToast, copyToastMessage, copyToastVariant }),
    [triggerCopyToast, showCopyToast, copyToastMessage, copyToastVariant]
  )

  return (
    <CopyToastContext.Provider value={value}>
      {children}
    </CopyToastContext.Provider>
  )
}

export default CopyToastContext
