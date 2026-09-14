/**
 * Curated best crypto / finance podcasts on Spotify.
 * Spotify show embeds need no API key; open.spotify.com is in the app CSP.
 * Verified show ids (2026-06-17).
 */
export const SPOTIFY_PODCASTS = [
  { id: 'sp_rollup',      name: 'The Rollup',        host: 'Rob & Andy',          spotifyId: '1P6ZeYd9vbF3hJA2n7qoL5', category: 'Markets',     c1: '#3a3f8f', c2: '#10122e', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab6772ab000015be478ffacaf2f4ee03990adee5' },
  { id: 'sp_bankless',    name: 'Bankless',          host: 'Ryan & David',        spotifyId: '41TNnXSv5ExcQSzEGLlGhy', category: 'Ethereum',    c1: '#2b2f6b', c2: '#0c0e22', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab6772ab000015be73591ce2ebb7f2e6e7929d65' },
  { id: 'sp_empire',      name: 'Empire',            host: 'Jason & Santiago',    spotifyId: '4UTePv1CR3APdKOiosR3Iq', category: 'Markets',     c1: '#7a5b1e', c2: '#221706', cover: 'https://image-cdn-ak.spotifycdn.com/image/ab6772ab000015bebd4aa54d38cb8490f80fc6ce' },
  { id: 'sp_unchained',   name: 'Unchained',         host: 'Laura Shin',          spotifyId: '1cJrrfGY1SKBIRn5noKSAf', category: 'Regulation',  c1: '#1f5f57', c2: '#08201d', cover: 'https://image-cdn-ak.spotifycdn.com/image/ab6772ab000015bed30532281cea527e263649ea' },
  { id: 'sp_bellcurve',   name: 'Bell Curve',        host: 'Blockworks',          spotifyId: '3uMWirMj2hc7IQYEUeBTyT', category: 'DeFi',        c1: '#4a2f6b', c2: '#160c22', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab6772ab000015be60a8928b00729e8265c7dd91' },
  { id: 'sp_lightspeed',  name: 'Lightspeed',        host: 'Blockworks',          spotifyId: '6JWaXUZF24H0joX1e30GYi', category: 'Solana',      c1: '#15604a', c2: '#07221a', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab6772ab000015bed0df21e4fc5b1264d6079475' },
  { id: 'sp_defiant',     name: 'The Defiant',       host: 'Camila Russo',        spotifyId: '1dYQYB5WxUqmypXXkFuac0', category: 'DeFi',        c1: '#6b2f3f', c2: '#220c12', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab6772ab000015be19617afc48041634b787b45c' },
  { id: 'sp_wbd',         name: 'What Bitcoin Did',  host: 'Peter McCormack',     spotifyId: '18Pixm6jNMATYXSO6cUnTH', category: 'Bitcoin',     c1: '#8a5a16', c2: '#251606', cover: 'https://image-cdn-ak.spotifycdn.com/image/ab67656300005f1f69232a858f022e8ae9d37a23' },
  { id: 'sp_pomp',        name: 'The Pomp Podcast',  host: 'Anthony Pompliano',   spotifyId: '0bn8XQHWGxXULjhp1jRmOJ', category: 'Macro',       c1: '#2f4a6b', c2: '#0c1422', cover: 'https://image-cdn-ak.spotifycdn.com/image/ab6772ab000015bea7dd2ad6af3ba22e7c4d011b' },
  { id: 'sp_coinstories', name: 'Coin Stories',      host: 'Natalie Brunell',     spotifyId: '0YOEwxAR1uIx1a15QpqE0l', category: 'Bitcoin',     c1: '#7a4a16', c2: '#221406', cover: 'https://image-cdn-fa.spotifycdn.com/image/ab67656300005f1fb403dd6c2b6d4eea8394098c' },
  { id: 'sp_unconfirmed', name: 'Unconfirmed',       host: 'Laura Shin',          spotifyId: '67Kt4UameBIU6KFUl8QJKj', category: 'Markets',     c1: '#3f4a6b', c2: '#0e1322', cover: 'https://image-cdn-ak.spotifycdn.com/image/ab67656300005f1fbdc2a46426c4b3c851abfc81' },
]

export function spotifyEmbedUrl(spotifyId) {
  return `https://open.spotify.com/embed/show/${spotifyId}?utm_source=generator&theme=0`
}
