/**
 * Extract display-friendly user info from a Privy user object.
 * Works with all login methods: email, Google, X, Telegram, Apple, wallet.
 */
export function getPrivyDisplayInfo(user) {
  if (!user) return { name: null, avatar: null, email: null }

  const tgName = user.telegram
    ? [user.telegram.firstName, user.telegram.lastName].filter(Boolean).join(' ') ||
      user.telegram.username ||
      null
    : null

  const name =
    user.google?.name ||
    user.twitter?.name ||
    tgName ||
    user.apple?.email?.split('@')[0] ||
    user.email?.address?.split('@')[0] ||
    (user.wallet?.address
      ? `${user.wallet.address.slice(0, 6)}...${user.wallet.address.slice(-4)}`
      : null)

  const email =
    user.email?.address ||
    user.google?.email ||
    user.apple?.email ||
    null

  const avatar =
    user.google?.picture ||
    // X/Twitter returns the 48px `_normal` variant by default - upgrade to the
    // 400px variant so it isn't pixelated at avatar size (no-op if not present).
    user.twitter?.profilePictureUrl?.replace('_normal', '_400x400') ||
    user.telegram?.photoUrl ||
    null

  return { name, avatar, email }
}
