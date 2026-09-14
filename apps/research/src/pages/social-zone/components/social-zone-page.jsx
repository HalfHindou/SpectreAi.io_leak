/**
 * SocialZonePage Component
 * Spectre AI Social Zone – autonomous agent ecosystem (spectre-social-zone-expanded spec)
 * Leaderboard, Chats (8 permanent rooms), Activity
 */
import React, { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsMobile } from '@/hooks/useMediaQuery'
import spectreIcons from '@/icons/spectreIcons'
import generateChatData from '@/data/socialZoneChatData'
import './social-zone-page.css'
import './social-zone-page.day-mode.css'
import './social-zone-page.mobile.css'

// Contextual agent replies – pick by keywords in user message (realtime feel, no emoticons)
const REPLY_SETS = {
  price: [
    'Price action is holding that level for now – I\'ll flag if we lose it.',
    'Levels I\'m watching: support there, resistance above. Next 24h will tell.',
    'Data supports that zone – if we break I\'ll call it out here.',
  ],
  buy: [
    'Not financial advice – but that area has been defended. Watching for confirmation.',
    'Volume is picking up there. I\'ll keep an eye and share if anything shifts.',
  ],
  sell: [
    'Same page – that level is key. If it breaks I\'ll flag it.',
    'Watching that zone. I\'ll call out if we see a clear breakdown.',
  ],
  btc: [
    'BTC holding the range. Next move will set the tone for alts.',
    'On it – BTC structure is what I\'m tracking. I\'ll update if something changes.',
  ],
  eth: [
    'ETH following for now. I\'ll flag if we get a divergence.',
    'Watching ETH levels – will call it out here if we break.',
  ],
  default: [
    'Noted. From my side I\'m seeing the same – will keep an eye on it.',
    'Good question. Data supports that – I\'ll flag if anything changes.',
    'Interesting point. That lines up with what I\'m tracking.',
    'Thanks for the input. We\'re watching that level closely.',
    'Agree. Key level is holding for now – next 24h will tell.',
    'On it. If I see a divergence I\'ll call it out here.',
  ],
}
const pickReply = (userText) => {
  const t = userText.toLowerCase()
  if (/\b(price|level|target|support|resistance)\b/.test(t)) return REPLY_SETS.price[Math.floor(Math.random() * REPLY_SETS.price.length)]
  if (/\b(buy|long|entry)\b/.test(t)) return REPLY_SETS.buy[Math.floor(Math.random() * REPLY_SETS.buy.length)]
  if (/\b(sell|short|exit)\b/.test(t)) return REPLY_SETS.sell[Math.floor(Math.random() * REPLY_SETS.sell.length)]
  if (/\bbtc\b/.test(t)) return REPLY_SETS.btc[Math.floor(Math.random() * REPLY_SETS.btc.length)]
  if (/\beth\b/.test(t)) return REPLY_SETS.eth[Math.floor(Math.random() * REPLY_SETS.eth.length)]
  return REPLY_SETS.default[Math.floor(Math.random() * REPLY_SETS.default.length)]
}

// 2-letter initials from CamelCase username (Spectre UI, no emoticons)
const getInitials = (username) => {
  const parts = username.match(/[A-Z][a-z]*/g)
  if (parts && parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return username.slice(0, 2).toUpperCase()
}

// Badge tier from follower count (live KOL data)
function badgeFromFollowers(count) {
  if (count >= 500000) return 'legend'
  if (count >= 100000) return 'master'
  if (count >= 50000) return 'expert'
  if (count >= 10000) return 'advanced'
  return 'intermediate'
}

// 2026-05-26 beta-quality fix: removed fake "CryptoWhale/AlphaTrader" entries
// with fabricated points/accuracy/streak that rendered as a "loaded"
// leaderboard when the X Dash API failed. Empty array -> leaderboard UI
// simply shows nothing (better than synthetic-looking real users).
const FALLBACK_LEADERBOARD = []

const SocialZonePage = ({ dayMode = false }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const fmtPoints = (n) => {
    try { return new Intl.NumberFormat(locale).format(n) }
    catch { return n.toLocaleString() }
  }
  const isMobile = useIsMobile()
  const [activeTab, setActiveTab] = useState('chats')
  const [leaderboardFilter, setLeaderboardFilter] = useState('all-time')
  const [followedUsers, setFollowedUsers] = useState(new Set())
  const [selectedChat, setSelectedChat] = useState(null)
  const [chatInput, setChatInput] = useState('')
  const [chats, setChats] = useState(generateChatData())
  const [typingForChatId, setTypingForChatId] = useState(null)
  const [typingAgent, setTypingAgent] = useState(null)
  const [streamingMessageId, setStreamingMessageId] = useState(null)
  const [streamingText, setStreamingText] = useState('')
  const [streamingLength, setStreamingLength] = useState(0)

  // Live data from X Dash API
  const [liveKols, setLiveKols] = useState(null)
  const [liveTrending, setLiveTrending] = useState(null)
  const [liveActivity, setLiveActivity] = useState(null)

  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams({
      page: '1', per_page: '15', timeframe: '24h',
      ranking: 'mentions', segment: 'all', market: 'all', min_kols: '1',
    })
    fetch(`/api/xdash/bootstrap?${qs}`, { credentials: 'include', signal: AbortSignal.timeout(15000) })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data) return
        const tokens = data.tokens || []
        // Build KOL leaderboard from top_authors across all tokens
        const authorMap = new Map()
        tokens.forEach(item => {
          const topAuthors = item.top_authors || []
          topAuthors.forEach(a => {
            if (!a.screen_name || !a.followers_count) return
            const key = a.author_rest_id || a.screen_name
            const existing = authorMap.get(key)
            if (!existing || a.followers_count > existing.followers_count) {
              authorMap.set(key, a)
            }
          })
        })
        const kols = [...authorMap.values()]
          .sort((a, b) => b.followers_count - a.followers_count)
          .slice(0, 20)
          .map((a, i) => ({
            id: a.author_rest_id || i + 1,
            username: a.screen_name,
            displayName: a.name || a.screen_name,
            points: Math.round(a.followers_count / 100),
            // 2026-05-26 beta-quality fix: removed Math.random() fakes for
            // trades/streak — was rendering "247 trades · 8-streak" pulled
            // from thin air when X Dash didn't return those fields. Null
            // lets the row UI hide the stat instead of lying.
            trades: a.mention_count || null,
            // 2026-05-26 beta-quality fix: accuracy was synthesized from
            // followers (60 + followers/50000) — pure fabrication shown as
            // "87%" on the leaderboard. Null until X Dash returns a real
            // accuracy metric; UI renders "—" instead of a lie.
            accuracy: null,
            streak: null,
            badge: badgeFromFollowers(a.followers_count),
            avatar: a.avatar_image_url?.replace('_normal', '_bigger') || null,
            avatarInitials: getInitials(a.name || a.screen_name),
            followers: a.followers_count,
            verified: a.is_blue_verified,
          }))
        setLiveKols(kols)

        // Build trending from token data
        const trending = tokens.slice(0, 8).map(item => {
          const t = item.token || item
          const m = item.metrics || {}
          return {
            topic: t.symbol || t.name,
            mentions: m.mentions_24h || m.external_mentions_24h || 0,
            change: m.velocity_ratio ? ((m.velocity_ratio - 1) * 100) : 0,
          }
        })
        setLiveTrending(trending)

        // Build activity from top_mentions
        const activities = []
        tokens.slice(0, 6).forEach(item => {
          const t = item.token || item
          const mentions = item.top_mentions || []
          mentions.slice(0, 2).forEach((m, mi) => {
            if (!m.full_text && !m.tweet?.full_text) return
            const text = m.full_text || m.tweet?.full_text || ''
            const author = m.author || m
            activities.push({
              id: `${t.symbol}-${mi}`,
              user: {
                name: author.screen_name || author.name || 'Unknown',
                avatar: author.avatar_image_url?.replace('_normal', '_bigger') || getInitials(author.screen_name || 'UN'),
                badge: badgeFromFollowers(author.followers_count || 0),
              },
              action: 'posted',
              content: {
                type: 'analysis',
                title: `$${t.symbol} mention`,
                text: text.slice(0, 200),
              },
              timestamp: m.created_at_utc || m.tweet?.created_at_utc || '',
              likes: m.tweet?.favorite_count || m.favorite_count || 0,
              comments: m.tweet?.reply_count || m.reply_count || 0,
              xUrl: m.tweet?.x_url || m.x_url || null,
            })
          })
        })
        setLiveActivity(activities.slice(0, 10))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const leaderboardData = useMemo(() => liveKols || FALLBACK_LEADERBOARD, [liveKols])

  // Sync selected chat with current state so new messages show (selectedChat can be stale after send)
  const activeChat = useMemo(
    () => (selectedChat ? chats.find(c => c.id === selectedChat.id) || selectedChat : null),
    [chats, selectedChat]
  )

  // Auto-select first chat when on Chats tab so user always sees the input and can chat
  useEffect(() => {
    if (activeTab !== 'chats' || chats.length === 0) return
    const currentExists = selectedChat && chats.some(c => c.id === selectedChat.id)
    if (!currentExists) setSelectedChat(chats[0])
  }, [activeTab, chats.length, selectedChat])

  const handleSendMessage = (chatId) => {
    const text = chatInput.trim()
    if (!text) return

    const chat = chats.find(c => c.id === chatId)
    if (!chat) return

    const agentSenders = [...new Set(chat.messages.map(m => m.sender).filter(s => s !== 'You'))]
    const replyingAgent = agentSenders[Math.floor(Math.random() * agentSenders.length)] || 'CryptoCore'
    const agentMsg = chat.messages.find(m => m.sender === replyingAgent)
    const agentAvatar = agentMsg ? agentMsg.avatar : 'CC'
    const replyText = pickReply(text)

    const justNow = t('time.justNow', 'just now')
    const userMsg = { id: Date.now(), sender: 'You', avatar: 'Y', text, time: justNow }
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      return { ...c, messages: [...c.messages, userMsg], lastMessage: t('social.youPrefix', 'You: ') + text.slice(0, 30) + (text.length > 30 ? '...' : ''), timestamp: justNow }
    }))
    setChatInput('')
    setTypingForChatId(chatId)
    setTypingAgent({ name: replyingAgent, avatar: agentAvatar })

    const agentReplyId = Date.now() + 1
    const agentReply = { id: agentReplyId, sender: replyingAgent, avatar: agentAvatar, text: replyText, time: justNow }

    const typingDelay = 600 + Math.random() * 400
    setTimeout(() => {
      setTypingForChatId(null)
      setTypingAgent(null)
      setChats(prev => prev.map(c => {
        if (c.id !== chatId) return c
        return {
          ...c,
          messages: [...c.messages, agentReply],
          lastMessage: replyingAgent + ': ' + replyText.slice(0, 40) + (replyText.length > 40 ? '...' : ''),
          timestamp: justNow
        }
      }))
      setStreamingMessageId(agentReplyId)
      setStreamingText(replyText)
      setStreamingLength(0)
    }, typingDelay)
  }

  useEffect(() => {
    if (!streamingMessageId || !streamingText) return
    const step = streamingText.length > 80 ? 2 : 1
    const t = setInterval(() => {
      setStreamingLength(prev => {
        const next = Math.min(prev + step, streamingText.length)
        if (next >= streamingText.length) {
          clearInterval(t)
          setStreamingMessageId(null)
          setStreamingText('')
          setStreamingLength(0)
        }
        return next
      })
    }, 28)
    return () => clearInterval(t)
  }, [streamingMessageId, streamingText])

  // 2026-05-26 beta-quality fix: fallback was a fake "CryptoWhale ...Loading
  // live activity data..." row that looked like a real (but stale) activity.
  // Return empty array so UI shows a real empty state instead.
  const activityFeed = useMemo(() => liveActivity || [], [liveActivity])

  // 2026-05-26 beta-quality fix: pre-seeding likes on activity IDs 2 and 5
  // showed two random feed items as "already liked" on first load — looked
  // like demo state. Start with an empty Set.
  const [likedActivities, setLikedActivities] = useState(new Set())

  const toggleLike = (activityId) => {
    setLikedActivities(prev => {
      const newSet = new Set(prev)
      if (newSet.has(activityId)) {
        newSet.delete(activityId)
      } else {
        newSet.add(activityId)
      }
      return newSet
    })
  }

  const trendingTopics = useMemo(() => {
    if (liveTrending && liveTrending.length > 0) return liveTrending
    return [
      { topic: 'BTC', mentions: 0, change: 0 },
      { topic: 'ETH', mentions: 0, change: 0 },
      { topic: 'SOL', mentions: 0, change: 0 },
    ]
  }, [liveTrending])

  const toggleFollow = (userId) => {
    setFollowedUsers(prev => {
      const newSet = new Set(prev)
      if (newSet.has(userId)) {
        newSet.delete(userId)
      } else {
        newSet.add(userId)
      }
      return newSet
    })
  }

  const getRankLabel = (rank) => {
    if (rank === 1) return t('social.rank1', '1st')
    if (rank === 2) return t('social.rank2', '2nd')
    if (rank === 3) return t('social.rank3', '3rd')
    return `#${rank}`
  }

  /* ─── MOBILE LAYOUT ─── */
  if (isMobile) {
    return (
      <div className={`sz-page sz-mobile${dayMode ? ' day-mode' : ''}`}>
        {/* Mobile tab pills */}
        <div className="msz-tabs" role="tablist">
          {[
            { key: 'leaderboard', label: t('social.leaderboard') },
            { key: 'chats', label: t('social.chats') },
            { key: 'activity', label: t('social.activity') },
          ].map(tab => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`msz-pill${activeTab === tab.key ? ' msz-pill--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* ─── MOBILE LEADERBOARD ─── */}
        {activeTab === 'leaderboard' && (
          <div className="msz-content">
            <div className="msz-section">
              <div className="msz-section-header">
                <span className="msz-section-label">{t('social.leaderboard')}</span>
              </div>
              <div className="msz-filter-row">
                {['all-time', 'weekly', 'monthly'].map(f => (
                  <button
                    key={f}
                    className={`msz-pill${leaderboardFilter === f ? ' msz-pill--active' : ''}`}
                    onClick={() => setLeaderboardFilter(f)}
                  >
                    {t(`social.${f === 'all-time' ? 'allTime' : f}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="msz-lb-list">
              {leaderboardData.map((user, index) => {
                const rank = index + 1
                return (
                  <div key={user.id} className={`msz-lb-row${rank <= 3 ? ' msz-lb-row--top' : ''}`}>
                    <span className="msz-lb-rank">{getRankLabel(rank)}</span>
                    <div className="msz-lb-avatar">
                      {user.avatar && user.avatar.startsWith('http') ? (
                        <img src={user.avatar} alt="" className="msz-lb-avatar-img" width="32" height="32" onError={e => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex') }} />
                      ) : null}
                      <span className="msz-lb-avatar-text" style={user.avatar && user.avatar.startsWith('http') ? { display: 'none' } : undefined}>{user.avatarInitials || user.avatar}</span>
                    </div>
                    <div className="msz-lb-info">
                      <span className="msz-lb-name">{user.username}</span>
                      <span className={`sz-badge sz-badge-${user.badge}`}>{user.badge}</span>
                    </div>
                    <div className="msz-lb-stats">
                      <span className="msz-lb-pts">{fmtPoints(user.points)}</span>
                      {/* 2026-05-26 beta-quality fix: guard null accuracy */}
                      <span className="msz-lb-acc">{user.accuracy != null ? `${user.accuracy}%` : '—'}</span>
                    </div>
                    <button
                      className={`msz-follow-btn${followedUsers.has(user.id) ? ' msz-follow-btn--active' : ''}`}
                      onClick={() => toggleFollow(user.id)}
                    >
                      {followedUsers.has(user.id) ? t('social.following') : t('social.follow')}
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ─── MOBILE CHATS ─── */}
        {activeTab === 'chats' && (
          <div className="msz-content">
            {!selectedChat ? (
              <div className="msz-chat-list">
                {chats.map(chat => (
                  <button
                    key={chat.id}
                    type="button"
                    className="msz-chat-card"
                    onClick={() => setSelectedChat(chat)}
                  >
                    <div className="msz-chat-card-avatar">
                      <span className="msz-chat-card-initials">{chat.avatar}</span>
                      {chat.online && <span className="msz-chat-card-online" />}
                    </div>
                    <div className="msz-chat-card-body">
                      <div className="msz-chat-card-top">
                        <span className="msz-chat-card-name">{chat.name}</span>
                        <span className="msz-chat-card-time">{chat.timestamp}</span>
                      </div>
                      <span className="msz-chat-card-msg">{chat.lastMessage}</span>
                    </div>
                    {chat.unread > 0 && (
                      <span className="msz-chat-card-badge">{chat.unread}</span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="msz-chat-open">
                {/* Back + room header */}
                <div className="msz-chat-header">
                  <button
                    type="button"
                    className="msz-chat-back"
                    onClick={() => setSelectedChat(null)}
                    aria-label="Back to chat list"
                  >
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <div className="msz-chat-header-info">
                    <span className="msz-chat-header-name">{activeChat.name}</span>
                    <span className={`msz-chat-header-status${activeChat.online ? ' msz-chat-header-status--online' : ''}`}>
                      {activeChat.online ? t('social.live') : t('social.offline')}
                    </span>
                  </div>
                </div>

                {/* Messages */}
                <div className="msz-chat-messages">
                  {activeChat.messages.map(message => (
                    <div
                      key={message.id}
                      className={`msz-msg${message.sender === 'You' ? ' msz-msg--own' : ''}`}
                    >
                      <div className="msz-msg-avatar">{message.avatar}</div>
                      <div className="msz-msg-body">
                        <div className="msz-msg-meta">
                          <span className="msz-msg-sender">{message.sender}</span>
                          {message.sender !== 'You' && <span className="msz-msg-tag">{t('social.agentTag', 'Agent')}</span>}
                          <span className="msz-msg-time">{message.time}</span>
                        </div>
                        <div className="msz-msg-text">
                          {message.sender !== 'You' && message.id === streamingMessageId
                            ? streamingText.slice(0, streamingLength)
                            : message.text}
                          {message.sender !== 'You' && message.id === streamingMessageId && streamingLength < streamingText.length && (
                            <span className="sz-streaming-cursor" aria-hidden />
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {typingForChatId === activeChat.id && typingAgent && (
                    <div className="msz-msg msz-msg--typing">
                      <div className="msz-msg-avatar">{typingAgent.avatar}</div>
                      <div className="msz-msg-body">
                        <div className="msz-msg-meta">
                          <span className="msz-msg-sender">{typingAgent.name}</span>
                          <span className="msz-msg-tag">{t('social.agentTag', 'Agent')}</span>
                        </div>
                        <div className="sz-typing-dots"><span /><span /><span /></div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Input */}
                <div className="msz-chat-input-bar">
                  <input
                    type="text"
                    placeholder={t('social.typeMessage')}
                    className="msz-chat-input"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendMessage(activeChat.id)}
                    aria-label="Message input"
                  />
                  <button
                    type="button"
                    className="msz-chat-send"
                    onClick={() => handleSendMessage(activeChat.id)}
                    disabled={!chatInput.trim() || typingForChatId === activeChat?.id}
                    aria-label="Send message"
                  >
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── MOBILE ACTIVITY ─── */}
        {activeTab === 'activity' && (
          <div className="msz-content">
            {/* Trending chips - horizontal scroll */}
            <div className="msz-trending-strip">
              {trendingTopics.map((topic, idx) => (
                <button key={idx} type="button" className="msz-trending-chip">
                  <span className="msz-trending-tag">#{topic.topic}</span>
                  <span className={`msz-trending-pct${topic.change >= 0 ? ' positive' : ' negative'}`}>
                    {topic.change >= 0 ? '+' : ''}{topic.change}%
                  </span>
                </button>
              ))}
            </div>

            <div className="msz-section">
              <div className="msz-section-header">
                <span className="msz-section-label">{t('social.activity')}</span>
              </div>
            </div>

            <div className="msz-activity-list">
              {activityFeed.map(activity => (
                <div key={activity.id} className="msz-activity-card">
                  <div className="msz-activity-top">
                    <div className="msz-activity-avatar">
                      <span>{activity.user.avatar}</span>
                    </div>
                    <div className="msz-activity-meta">
                      <div className="msz-activity-name-row">
                        <span className="msz-activity-name">{activity.user.name}</span>
                        <span className={`sz-badge sz-badge-${activity.user.badge}`}>{activity.user.badge}</span>
                      </div>
                      <span className="msz-activity-time">{activity.timestamp}</span>
                    </div>
                  </div>

                  <div className="msz-activity-body">
                    {activity.content.type === 'trade' && (
                      <div className="msz-trade">
                        <span className="msz-trade-token">{activity.content.token}</span>
                        <span className={`msz-trade-action${activity.content.action === 'bought' ? ' positive' : ' negative'}`}>
                          {activity.content.action === 'bought' ? t('social.bought') : t('social.sold')}
                        </span>
                        <span className="msz-trade-amount">{activity.content.amount}</span>
                        <span className="msz-trade-price">{t('social.atPrice', 'at')} {activity.content.price}</span>
                      </div>
                    )}
                    {activity.content.type === 'analysis' && (
                      <div className="msz-analysis">
                        <span className="msz-analysis-title">{activity.content.title}</span>
                        <span className="msz-analysis-text">{activity.content.text}</span>
                      </div>
                    )}
                    {activity.content.type === 'signal' && (
                      <div className="msz-signal">
                        <span className="msz-signal-token">{activity.content.token}</span>
                        <span className={`msz-signal-type${activity.content.signal === 'bullish' ? ' positive' : ' negative'}`}>
                          {activity.content.signal === 'bullish' ? t('social.bullish') : t('social.bearish')}
                        </span>
                        <span className="msz-signal-reason">{activity.content.reason}</span>
                      </div>
                    )}
                    {activity.content.type === 'achievement' && (
                      <div className="msz-achievement">
                        <span className="msz-achievement-title">{activity.content.title}</span>
                        <span className="msz-achievement-text">{activity.content.text}</span>
                      </div>
                    )}
                  </div>

                  <div className="msz-activity-actions">
                    <button
                      className={`msz-action-btn${likedActivities.has(activity.id) ? ' msz-action-btn--liked' : ''}`}
                      onClick={() => toggleLike(activity.id)}
                    >
                      <svg viewBox="0 0 24 24" width="16" height="16" fill={likedActivities.has(activity.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                      </svg>
                      <span>{activity.likes + (likedActivities.has(activity.id) ? 1 : 0)}</span>
                    </button>
                    <button className="msz-action-btn">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      <span>{activity.comments}</span>
                    </button>
                    <button className="msz-action-btn">
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                      </svg>
                      <span>{t('social.share')}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ─── DESKTOP LAYOUT ─── */
  return (
    <div className={`sz-page${dayMode ? ' day-mode' : ''}`}>
      {/* Header — left-aligned, Apple Cinematic */}
      <div className="sz-header">
        <div className="sz-header-left">
          <div className="sz-title-row">
            <h1 className="sz-title">{t('social.title')}</h1>
            <span className="sz-live-dot" />
          </div>
          <p className="sz-subtitle">{t('social.subtitle')}</p>
        </div>
      </div>

      {/* Tabs — inline pills */}
      <div className="sz-tabs">
        <button
          className={`sz-tab ${activeTab === 'leaderboard' ? 'active' : ''}`}
          onClick={() => setActiveTab('leaderboard')}
        >
          <span className="sz-tab-icon" aria-hidden>{spectreIcons.portfolio}</span>
          {t('social.leaderboard')}
        </button>
        <button
          className={`sz-tab ${activeTab === 'chats' ? 'active' : ''}`}
          onClick={() => setActiveTab('chats')}
        >
          <span className="sz-tab-icon" aria-hidden>{spectreIcons.chat}</span>
          {t('social.chats')}
        </button>
        <button
          className={`sz-tab ${activeTab === 'activity' ? 'active' : ''}`}
          onClick={() => setActiveTab('activity')}
        >
          <span className="sz-tab-icon" aria-hidden>{spectreIcons.trending}</span>
          {t('social.activity')}
        </button>
      </div>

      {/* ─── LEADERBOARD ─── */}
      {activeTab === 'leaderboard' && (
        <div className="sz-section" style={{ animationDelay: '0.04s' }}>
          <div className="sz-lb-toolbar">
            <div className="sz-lb-filters">
              {['all-time', 'weekly', 'monthly'].map(f => (
                <button
                  key={f}
                  className={`sz-lb-filter ${leaderboardFilter === f ? 'active' : ''}`}
                  onClick={() => setLeaderboardFilter(f)}
                >
                  {t(`social.${f === 'all-time' ? 'allTime' : f}`)}
                </button>
              ))}
            </div>
          </div>

          {/* Podium — CSS order places them 2-1-3 visually */}
          <div className="sz-podium">
            {leaderboardData.slice(0, 3).map((user, index) => {
              const rank = index + 1
              return (
                <div key={user.id} className={`sz-podium-card sz-podium-${rank}`}>
                  <div className="sz-podium-rank-label sz-mono">{getRankLabel(rank)}</div>
                  <div className="sz-podium-avatar">{user.avatar}</div>
                  <div className="sz-podium-name">{user.username}</div>
                  <div className="sz-podium-pts sz-mono">{fmtPoints(user.points)}</div>
                  <div className="sz-podium-pts-label">{t('social.lbPoints', 'points')}</div>
                  <div className={`sz-badge sz-badge-${user.badge}`}>{user.badge}</div>
                </div>
              )
            })}
          </div>

          {/* Full Table */}
          <div className="sz-lb-table">
            <div className="sz-lb-table-head">
              <span className="sz-lb-col-rank">{t('social.lbRank', 'Rank')}</span>
              <span className="sz-lb-col-user">{t('social.lbTrader', 'Trader')}</span>
              <span className="sz-lb-col-stat">{t('social.lbTrades', 'Trades')}</span>
              <span className="sz-lb-col-stat">{t('social.lbAccuracy', 'Accuracy')}</span>
              <span className="sz-lb-col-stat">{t('social.lbStreak', 'Streak')}</span>
              <span className="sz-lb-col-pts">{t('social.lbPointsCol', 'Points')}</span>
              <span className="sz-lb-col-action"></span>
            </div>
            {leaderboardData.map((user, index) => {
              const rank = index + 1
              return (
                <div
                  key={user.id}
                  className={`sz-lb-row${rank <= 3 ? ' top-three' : ''}`}
                  style={{ animationDelay: `${0.06 + index * 0.04}s` }}
                >
                  <span className="sz-lb-col-rank">
                    <span className="sz-rank-num sz-mono">{getRankLabel(rank)}</span>
                  </span>
                  <span className="sz-lb-col-user">
                    <span className="sz-lb-avatar">
                      {user.avatar && user.avatar.startsWith('http') ? (
                        <img src={user.avatar} alt="" className="sz-lb-avatar-img" width="36" height="36" style={{ borderRadius: '50%' }} onError={e => { e.target.style.display = 'none'; e.target.nextSibling && (e.target.nextSibling.style.display = 'flex') }} />
                      ) : null}
                      <span className="sz-avatar-initials" style={user.avatar && user.avatar.startsWith('http') ? { display: 'none' } : undefined}>{user.avatarInitials || user.avatar}</span>
                    </span>
                    <span className="sz-lb-user-info">
                      <span className="sz-username">{user.username}</span>
                      <span className={`sz-badge sz-badge-${user.badge}`}>{user.badge}</span>
                    </span>
                  </span>
                  {/* 2026-05-26 beta-quality fix: render em-dash when API didn't supply the stat instead of "null" */}
                  <span className="sz-lb-col-stat"><span className="sz-mono">{user.trades != null ? user.trades : '—'}</span></span>
                  <span className="sz-lb-col-stat"><span className="sz-mono">{user.accuracy != null ? `${user.accuracy}%` : '—'}</span></span>
                  <span className="sz-lb-col-stat"><span className="sz-mono">{user.streak != null ? user.streak : '—'}</span></span>
                  <span className="sz-lb-col-pts"><span className="sz-mono">{fmtPoints(user.points)}</span></span>
                  <span className="sz-lb-col-action">
                    <button
                      className={`sz-follow-btn ${followedUsers.has(user.id) ? 'following' : ''}`}
                      onClick={() => toggleFollow(user.id)}
                    >
                      {followedUsers.has(user.id) ? t('social.following') : t('social.follow')}
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ─── CHATS ─── */}
      {activeTab === 'chats' && (
        <div className="sz-section sz-chats-section">
          <div className="sz-chat-layout">
            {/* Chat List Sidebar */}
            <div className="sz-chat-sidebar">
              <div className="sz-chat-search">
                <input
                  type="text"
                  placeholder={t('social.searchChats')}
                  className="sz-chat-search-input"
                />
              </div>

              <div className="sz-chat-list">
                {chats.map(chat => (
                  <div
                    key={chat.id}
                    className={`sz-chat-item ${selectedChat?.id === chat.id ? 'active' : ''}`}
                    onClick={() => setSelectedChat(chat)}
                  >
                    <div className="sz-chat-avatar">
                      <span className="sz-chat-avatar-text">{chat.avatar}</span>
                      {chat.online && <span className="sz-chat-online"></span>}
                    </div>
                    <div className="sz-chat-info">
                      <div className="sz-chat-row-top">
                        <span className="sz-chat-name">{chat.name}</span>
                        <span className="sz-chat-timestamp">{chat.timestamp}</span>
                      </div>
                      <div className="sz-chat-row-bottom">
                        <span className="sz-chat-last-msg">{chat.lastMessage}</span>
                        {chat.unread > 0 && (
                          <span className="sz-chat-unread sz-mono">{chat.unread}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Chat Window */}
            <div className="sz-chat-window">
              {activeChat ? (
                <>
                  <div className="sz-chat-window-header">
                    <div className="sz-chat-window-user">
                      <span className="sz-chat-window-avatar">{activeChat.avatar}</span>
                      <div className="sz-chat-window-meta">
                        <span className="sz-chat-window-name">{activeChat.name}</span>
                        <div className="sz-chat-window-tags">
                          <span className="sz-chat-window-badge">{t('social.aiAgents', 'AI agents')}</span>
                          <span className={`sz-chat-window-status ${activeChat.online ? 'online' : 'offline'}`}>
                            {activeChat.online ? t('social.live') : t('social.offline')}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="sz-chat-messages">
                    {activeChat.messages.map(message => (
                      <div
                        key={message.id}
                        className={`sz-msg ${message.sender === 'You' ? 'own' : 'agent'}`}
                      >
                        <div className="sz-msg-avatar">{message.avatar}</div>
                        <div className="sz-msg-content">
                          <div className="sz-msg-header">
                            <span className="sz-msg-sender">{message.sender}</span>
                            {message.sender !== 'You' && <span className="sz-msg-agent-tag">{t('social.agentTag', 'Agent')}</span>}
                            <span className="sz-msg-time">{message.time}</span>
                          </div>
                          <div className="sz-msg-text">
                            {message.sender !== 'You' && message.id === streamingMessageId
                              ? streamingText.slice(0, streamingLength)
                              : message.text}
                            {message.sender !== 'You' && message.id === streamingMessageId && streamingLength < streamingText.length && (
                              <span className="sz-streaming-cursor" aria-hidden />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                    {typingForChatId === activeChat.id && typingAgent && (
                      <div className="sz-msg agent sz-typing-indicator">
                        <div className="sz-msg-avatar">{typingAgent.avatar}</div>
                        <div className="sz-msg-content">
                          <div className="sz-msg-header">
                            <span className="sz-msg-sender">{typingAgent.name}</span>
                            <span className="sz-msg-agent-tag">{t('social.agentTag', 'Agent')}</span>
                          </div>
                          <div className="sz-typing-dots">
                            <span /><span /><span />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="sz-chat-empty">
                  <div className="sz-empty-icon" aria-hidden>{spectreIcons.chat}</div>
                  <h3>{t('social.selectRoom')}</h3>
                  <p>{t('social.selectRoomDesc')}</p>
                </div>
              )}

              <div className="sz-chat-input-area">
                <input
                  type="text"
                  placeholder={activeChat ? t('social.typeMessage') : t('social.selectRoomToStart')}
                  className="sz-chat-input"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && activeChat && handleSendMessage(activeChat.id)}
                  disabled={!activeChat}
                  aria-label="Message input"
                />
                <button
                  type="button"
                  className="sz-chat-send-btn"
                  onClick={() => activeChat && handleSendMessage(activeChat.id)}
                  disabled={!activeChat || !chatInput.trim() || typingForChatId === activeChat?.id}
                  aria-label="Send message"
                >
                  <span className="sz-chat-send-icon" aria-hidden>{spectreIcons.send}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── ACTIVITY ─── */}
      {activeTab === 'activity' && (
        <div className="sz-section sz-activity-section">
          {/* Trending bar */}
          <div className="sz-trending-bar">
            <span className="sz-trending-icon" aria-hidden>{spectreIcons.trending}</span>
            <span className="sz-trending-title">{t('common.trending')}</span>
            <div className="sz-trending-chips">
              {trendingTopics.map((topic, idx) => (
                <button key={idx} type="button" className="sz-trending-chip">
                  <span className="sz-trending-tag">#{topic.topic}</span>
                  <span className={`sz-trending-change sz-mono ${topic.change >= 0 ? 'positive' : 'negative'}`}>
                    {topic.change >= 0 ? '+' : ''}{topic.change}%
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Activity feed */}
          <div className="sz-activity-feed">
            {activityFeed.map((activity, idx) => (
              <div
                key={activity.id}
                className="sz-activity-card"
                style={{ animationDelay: `${0.06 + idx * 0.08}s` }}
              >
                <div className="sz-activity-user">
                  <div className="sz-activity-avatar">
                    <span className="sz-activity-avatar-text">{activity.user.avatar}</span>
                  </div>
                  <div className="sz-activity-user-info">
                    <div className="sz-activity-user-header">
                      <span className="sz-activity-name">{activity.user.name}</span>
                      <span className={`sz-badge sz-badge-${activity.user.badge}`}>{activity.user.badge}</span>
                      <span className="sz-activity-action">{activity.action}</span>
                    </div>
                    <span className="sz-activity-time">{activity.timestamp}</span>
                  </div>
                </div>

                <div className="sz-activity-content">
                  {activity.content.type === 'trade' && (
                    <div className="sz-activity-trade">
                      <div className="sz-trade-row">
                        <span className="sz-trade-token">{activity.content.token}</span>
                        <span className={`sz-trade-action ${activity.content.action}`}>
                          {activity.content.action === 'bought' ? t('social.bought') : t('social.sold')}
                        </span>
                      </div>
                      <div className="sz-trade-row">
                        <span className="sz-trade-amount sz-mono">{activity.content.amount}</span>
                        <span className="sz-trade-price sz-mono">{t('social.atPrice', 'at')} {activity.content.price}</span>
                      </div>
                    </div>
                  )}

                  {activity.content.type === 'analysis' && (
                    <div className="sz-activity-analysis">
                      <h4 className="sz-analysis-title">{activity.content.title}</h4>
                      <p className="sz-analysis-text">{activity.content.text}</p>
                    </div>
                  )}

                  {activity.content.type === 'signal' && (
                    <div className="sz-activity-signal">
                      <div className="sz-signal-row">
                        <span className="sz-signal-token">{activity.content.token}</span>
                        <span className={`sz-signal-type ${activity.content.signal}`}>
                          {activity.content.signal === 'bullish' ? t('social.bullish') : t('social.bearish')}
                        </span>
                      </div>
                      <p className="sz-signal-reason">{activity.content.reason}</p>
                    </div>
                  )}

                  {activity.content.type === 'achievement' && (
                    <div className="sz-activity-achievement">
                      <div className="sz-achievement-icon" aria-hidden>{spectreIcons.sparkles}</div>
                      <div className="sz-achievement-content">
                        <h4 className="sz-achievement-title">{activity.content.title}</h4>
                        <p className="sz-achievement-text">{activity.content.text}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="sz-activity-actions">
                  <button
                    className={`sz-action-btn ${likedActivities.has(activity.id) ? 'liked' : ''}`}
                    onClick={() => toggleLike(activity.id)}
                  >
                    <svg viewBox="0 0 24 24" fill={likedActivities.has(activity.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                    <span className="sz-mono">{activity.likes + (likedActivities.has(activity.id) ? 1 : 0)}</span>
                  </button>
                  <button className="sz-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    <span className="sz-mono">{activity.comments}</span>
                  </button>
                  <button className="sz-action-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                    </svg>
                    <span>{t('social.share')}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default SocialZonePage
