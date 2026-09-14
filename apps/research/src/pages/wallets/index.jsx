import { useIsMobile } from '@/hooks/useMediaQuery'
import WalletsPage from './components/wallets-page'

export default function WalletsPageWrapper() {
  const isMobile = useIsMobile()
  return <WalletsPage isMobile={isMobile} />
}
