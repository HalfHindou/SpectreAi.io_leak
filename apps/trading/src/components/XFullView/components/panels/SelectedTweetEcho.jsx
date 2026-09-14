import { memo } from 'react'

/**
 * SelectedTweetEcho — anchors the right pane visually with a small
 * confirmation card showing avatar + handle + first 80 chars of the
 * selected tweet, plus an "Open in X" link.
 */
function SelectedTweetEcho({ tweet }) {
  const sourceHandle = tweet?._sourceHandle || tweet?.handle || ''
  const sourceId = tweet?._sourceTweetId || tweet?.id
  const tweetUrl = sourceHandle && sourceId
    ? `https://x.com/${sourceHandle.replace('@', '')}/status/${sourceId}`
    : null

  const preview = truncate(tweet?.content || '', 96)

  return (
    <div className="xfv-intel-section xfv-intel-echo">
      <div className="xfv-intel-section-label">SELECTED TWEET</div>
      <div className="xfv-intel-echo-row">
        {tweet?.avatar && (
          <img className="xfv-intel-echo-avatar" src={tweet.avatar} alt="" loading="lazy" />
        )}
        <div className="xfv-intel-echo-body">
          <div className="xfv-intel-echo-author-row">
            <span className="xfv-intel-echo-author">{tweet?.user || 'Unknown'}</span>
            {tweet?.handle && <span className="xfv-intel-echo-handle">{tweet.handle}</span>}
          </div>
          <div className="xfv-intel-echo-preview">{preview}</div>
        </div>
      </div>
      {tweetUrl && (
        <a
          href={tweetUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="xfv-intel-echo-link"
        >
          Open in X
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </a>
      )}
    </div>
  )
}

function truncate(s, n) {
  if (!s) return ''
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`
}

export default memo(SelectedTweetEcho)
