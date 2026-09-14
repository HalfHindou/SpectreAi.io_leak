/**
 * useIsAppActive - React binding for the app-wide idle tracker.
 *
 * Returns `true` while the user is active, `false` after 5 min of no
 * interaction (even if the tab is still visible). Re-renders on transition.
 * For poll guards inside an interval body, import `isAppActive()` directly
 * instead - it does not subscribe and avoids re-renders.
 */
import { useSyncExternalStore } from 'react';
import { isAppActive, subscribeActivity } from '../lib/idleManager';

export default function useIsAppActive() {
  return useSyncExternalStore(subscribeActivity, isAppActive, () => true);
}
