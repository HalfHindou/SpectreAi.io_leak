export default function NewsroomFooter() {
  return (
    <footer className="newsroom-footer">
      <div className="newsroom-footer__links">
        <a href="/api/rss" className="newsroom-footer__link" target="_blank" rel="noopener">RSS All</a>
        <a href="/api/rss/news" className="newsroom-footer__link" target="_blank" rel="noopener">RSS News</a>
        <a href="/api/rss/daily" className="newsroom-footer__link" target="_blank" rel="noopener">RSS Daily</a>
        <a href="/api/rss/crypto" className="newsroom-footer__link" target="_blank" rel="noopener">RSS Crypto</a>
        <a href="/api/rss/stocks" className="newsroom-footer__link" target="_blank" rel="noopener">RSS Stocks</a>
      </div>
      <div className="newsroom-footer__disclaimer">
        Published by Spectre AI. AI-generated research for informational purposes only. Not financial advice.
      </div>
    </footer>
  )
}
