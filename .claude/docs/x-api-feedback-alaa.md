# X API Feedback — Data Shape Improvements

**To:** Alaa
**From:** Gleb
**Date:** 2026-04-09
**Scope:** `/get_official_tweets` and `/search_tweets` endpoints on the X API backend

---

We integrated the X API into the trading app's token page X feed. A few data-shape issues are making it hard to render the feed accurately. Flagging them in priority order.

---

## 1. Retweets return 0 for likes and comments on the wrapper

The RT record carries only a partial `retweets` count; `likes` and `comments` are always 0, and `views` is `"0"` or `"1"`. Users see `0 | 29 | 0` on every retweet, which looks broken.

**Fix:** either (a) copy the source post's engagement metrics onto the RT record, or (b) embed the full source post under a `retweeted_tweet` key so we can render proper counts.

**Current response:**

```json
{
  "tweet_id": "2041985053693976614",
  "tweet_text": "RT @Spectre__AI: Tick-tock new website...",
  "likes": 0,
  "retweets": 29,
  "comments": 0,
  "views": "1"
}
```

**Expected:**

```json
{
  "tweet_id": "2041985053693976614",
  "tweet_text": "RT @Spectre__AI: Tick-tock new website...",
  "retweeted_tweet": {
    "tweet_id": "2041935585875476640",
    "username": "Spectre__AI",
    "likes": 65,
    "retweets": 29,
    "comments": 25,
    "views": "1409"
  }
}
```

Right now we work around this by scanning the full feed for a matching original post via normalized text matching. Fragile and only works when the source is already in our result set.

---

## 2. No `in_reply_to_tweet_id` / `conversation_id` field

Replies have no parent tweet ID or conversation ID. We can only match replies to parents by extracting `@handle` from the tweet text, which fails in two common cases.

**Bug A - multi-user threads:** Spectre posted `@CryptoWizardd @Gyokeres_eth Way more!` - a reply inside a thread. We have no way to tell which of the two tagged users is the actual parent. We ended up treating both as parents, which is a guess.

**Bug B - self-replies (worse):** When the project replies to its OWN tweet, X drops the `@handle` prefix entirely. Example: <https://x.com/Spectre__AI/status/2042210023409881464>

That tweet is a reply in a Spectre thread, but the upstream API returns it with this shape:

```json
{
  "tweet_id": "2042210023409881464",
  "tweet_text": "Rhetorical but we will type this out - this will power the Spectre AI upcoming new App.",
  "username": "Spectre__AI",
  "likes": 3,
  "retweets": 0,
  "comments": 0
}
```

No reply indicator at all. From our side it looks identical to a standalone post, so we render it as a "Project Post" instead of a "Reply", and users see a reply without the original tweet it's responding to. There is no client-side fix.

**Fix:** forward Twitter API v2's `referenced_tweets[]` (where `type: "replied_to"`), `in_reply_to_user_id`, and `conversation_id`. Twitter already provides these - they just need to pass through your scraper.

---

## 3. Thread-context tweets are mixed into the feed with no flag

`/get_official_tweets?username=Spectre__AI` returns 29 tweets, but 8 of them are from third parties (BlackholeDEX, adam3us, WatcherGuru, Grayscale, neutanent, Invubu, Gyokeres_eth, FrankLambeek) pulled in as thread parents because Spectre replied to them.

There is no flag distinguishing:

- Spectre's own posts
- Spectre's retweets
- Spectre's replies
- Third-party parent tweets (thread context)

We had to infer the third category by checking whether any Spectre reply's `replyingTo` handle matches. That is brittle.

**Fix:** add a `context_type` field:

```json
{ "context_type": "authored" }       // Spectre's own post
{ "context_type": "retweet" }        // Spectre retweeted this
{ "context_type": "reply" }          // Spectre replied to this
{ "context_type": "thread_parent" }  // Thread context, Spectre did not post this
```

---

## 4. `views` field type is inconsistent

Sometimes it is a string (`"1409"`), sometimes a number (`1406`). Pick one. We are currently `parseInt`-ing defensively on every tweet.

---

## 5. No pagination, max_results, or cursor

We get 29 tweets and do not know if that is the limit or the full set. Please add `max_results` query param and `next_cursor` in the response. Useful for loading more on scroll.

---

## 6. No rate limit headers

When the upstream hits a limit we just see a 502. Please forward X API's `x-rate-limit-remaining` and `x-rate-limit-reset` headers so we can back off client-side instead of spamming.

---

## Priority order (from our standpoint)

| # | Issue | Severity | Effort |
|---|---|---|---|
| 1 | Retweet engagement metrics | High - breaks the UI today | Small |
| 2 | `in_reply_to_tweet_id` | Medium - fixes thread matching | Small |
| 3 | `context_type` flag | Medium - fixes feed filtering | Medium |
| 4 | Views type consistency | Low - easy fix | Tiny |
| 5 | Pagination + cursor | Low - nice to have | Medium |
| 6 | Rate limit headers | Low - nice to have | Tiny |

---

Let me know if you want to jump on a call to walk through the trading dashboard and see exactly where each one bites us.
