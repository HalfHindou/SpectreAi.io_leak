import { Suspense, useMemo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import PageLayout from './page-layout'
import RouteFallback from '@/components/route-fallback'
import { getPageIdFromPath } from '@/constants/pageRoutes'

export default function PageShell() {
  const location = useLocation()

  const centered = useMemo(() => {
    return false
  }, [location.pathname])

  // Inner Suspense boundary scoped to the page content. While a lazy page
  // chunk is loading, the AppShell chrome (sidebar/header) STAYS painted and
  // only the content area shows the brand loader — instead of unmounting
  // the whole shell back to a black screen. Keyed by pathname so the
  // fallback re-mounts on every navigation (otherwise React would keep the
  // previous page visible until the next is ready, which is fine in theory
  // but caused stale-data flashes when the new page started fetching).
  //
  // EXCEPTION: /x-dash keys once for its whole tree. Its sub-routes (token /
  // author drawers, kol profile) are overlays over ONE mounted board - a
  // per-pathname key remounted the entire page on every drawer open (scroll
  // thrown to top + full repaint before the panel slid in).
  const suspenseKey = getPageIdFromPath(location.pathname) === 'x-dash'
    ? 'x-dash'
    : location.pathname
  return (
    <div className="app-main-content">
      <PageLayout centered={centered}>
        <Suspense key={suspenseKey} fallback={<RouteFallback shell />}>
          <Outlet />
        </Suspense>
      </PageLayout>
    </div>
  )
}
