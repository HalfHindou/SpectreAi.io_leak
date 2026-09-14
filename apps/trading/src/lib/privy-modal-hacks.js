/**
 * Privy login modal UX customizations - DOM hacks that work around
 * limitations in the Privy React SDK (^3.16.0).
 *
 * These exist because Privy does not expose config flags for these tweaks
 * and the nested CSS `:has()` selectors needed to target Privy's wrapping
 * DOM structure are not valid in any current browser.
 *
 * Audit-gaps #11 originally flagged these as fragile defensive code. They
 * are not - they are LOAD-BEARING UX customizations addressing real Privy
 * SDK gaps. The audit's proposed fix (replace with `loginMethodsAndOrder`
 * email-first + `showWalletLoginFirst: false` config) does NOT remove the
 * need:
 *
 * 1. The email auto-click is NOT about modal ordering. Privy renders the
 *    "Continue with Email" tile COLLAPSED for returning users (one click
 *    needed to reveal the input). Auto-clicking matches the fresh-user
 *    UX where the input shows inline. This is independent of which login
 *    method appears first.
 *
 * 2. The wallet list scroll fix patches a real react-window virtualizer
 *    bug: Privy claims a 37327px container height (612 wallets) but only
 *    pre-renders ~14. The scroll listener doesn't fire to load more, so
 *    the other 598 wallets are unreachable except via the search input.
 *
 * Remove this module ONCE Privy ships fixes for both behaviors. Until
 * then, treat the hacks as part of the brand's login UX.
 *
 * Side effect: mounts two MutationObservers on document.body. Idempotent
 * via the `applied` flag - safe to call multiple times.
 */

let applied = false

export function applyPrivyModalHacks() {
  if (applied) return
  if (typeof document === 'undefined') return // SSR safety
  applied = true

  // Hook 1: auto-expand the "Continue with Email" tile so the email input
  // field shows inline. Privy renders the tile collapsed for returning users.
  // We click it once per modal mount so the input is visible by default.
  // Hook 2: make the wallet picker scrollable. Privy uses react-window for
  // 612 wallets but only renders ~14 - the rest are unreachable without
  // forcing overflow:auto + capping the container height.
  let clickedFor = null

  const obs = new MutationObserver(() => {
    const modal = document.querySelector('#privy-modal-content')
    if (!modal) {
      clickedFor = null
      return
    }

    // -- Hook 1: email tile auto-click (once per modal mount) --
    if (clickedFor !== modal) {
      const emailTile = [...modal.querySelectorAll('button.login-method-button')]
        .find(b => /Continue with Email/i.test(b.textContent || ''))
      const inputVisible = !!modal.querySelector('input[type="email"]:not([hidden])')
      if (emailTile && !inputVisible) {
        clickedFor = modal
        // Defer so Privy can finish its initial render before we trigger state change
        setTimeout(() => {
          try { emailTile.click() } catch (_) { /* user may have closed modal */ }
        }, 50)
      } else if (inputVisible) {
        clickedFor = modal
      }
    }

    // -- Hook 3: returning-layout guard --
    // Privy lays the social/wallet buttons out in a multi-column GRID for fresh
    // logins, but in the returning "last used" layout the same container becomes
    // a full-width FLEX column (and a lone "Continue with Email" button sits in a
    // 1-item grid). The tile/wallet CSS is tuned for the multi-tile grid; in the
    // other layouts Privy renders the buttons as giant full-width tiles and the
    // wallet relabel misfires onto the email button. Tag any login-button
    // container that is NOT a real multi-tile grid so CSS renders it as clean
    // full-width rows. Checks the COMPUTED layout (not Privy's markup), so it
    // survives Privy's sub-states and styled-component class-hash changes.
    modal.querySelectorAll('button.login-method-button').forEach((btn) => {
      const c = btn.parentElement
      if (!c) return
      const cs = getComputedStyle(c)
      const cols = (cs.gridTemplateColumns || '').trim()
      const lmbCount = c.querySelectorAll(':scope > button.login-method-button').length
      const isTileGrid =
        cs.display === 'grid' &&
        cols && cols !== 'none' && cols.split(/\s+/).length > 1 &&
        lmbCount >= 2
      // Only stack a real multi-method container that is NOT a clean multi-tile grid
      // (Privy's flex "last used" layout). A multi-tile GRID stays a grid even with a
      // non-login-method "last used" tile (MetaMask) - that tile is restyled to a
      // single-column tile + its chain badge hidden in index.css. Single-button
      // containers (e.g. the redundant "Continue with Email" tile) are left alone so
      // their display:none hide rule wins.
      c.classList.toggle('spectre-modal-stacked', !isTileGrid && lmbCount >= 2)
    })

    // -- Hook 2: wallet list scroll fix --
    // ONLY the big 600+ wallet picker needs this - it's the one with a search
    // input ("Search through N wallets") and react-window virtualization. The
    // "Select network" sub-screen (shown after picking a multi-chain wallet like
    // MetaMask/Phantom) has the SAME wallet-row buttons but only 2-3 of them and
    // NO search input; capping its container there clipped the 2nd row. Bail
    // unless the wallet-search input is present so the network screen is untouched.
    const walletSearch = modal.querySelector('input[placeholder*="wallet" i], input[placeholder*="Search" i]')
    if (!walletSearch) return

    // Find a wallet row button (width > 200px, name contains a known wallet).
    const row = [...modal.querySelectorAll('button')].find(b =>
      b.offsetWidth > 200 && /MetaMask|Phantom|Coinbase|Wallet/i.test(b.textContent || '')
    )
    if (!row) return

    // Walk up 2 levels to reach Privy's L2 wrapper - that's where Privy's
    // react-window scroll listener expects events to bubble from.
    const l1 = row.parentElement
    const l2 = l1?.parentElement
    if (!l2 || l2.dataset.spectreScrollFixed === '1') return

    l2.dataset.spectreScrollFixed = '1'
    l2.style.setProperty('max-height', '380px', 'important')
    l2.style.setProperty('overflow-y', 'auto', 'important')
    l2.style.setProperty('overflow-x', 'hidden', 'important')
    l2.style.setProperty('scrollbar-width', 'thin', 'important')

    // Cap l1's virtual placeholder height (Privy sets `height: 37327px`) to
    // the actual rendered children. Sum of child heights = real content.
    // Other 598 wallets remain reachable via the modal's search input.
    const fitL1 = () => {
      const realH = [...l1.children].reduce((sum, c) => sum + c.offsetHeight, 0)
      if (realH > 0) l1.style.setProperty('height', realH + 'px', 'important')
    }
    fitL1()
    // Re-measure after Privy late-binds more rendered items (search results,
    // detected wallets that show up after extension probe completes).
    new MutationObserver(fitL1).observe(l1, { childList: true, subtree: false })
  })

  obs.observe(document.body, { childList: true, subtree: true })
}
