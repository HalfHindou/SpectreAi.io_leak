/**
 * alert-notify - delivery fan-out for alert triggers (Alerts 2.0 wave 2).
 *
 * One entry point used by BOTH engines (Codex webhook receiver + the
 * pct cron). Currently Web Push only; wave 3 adds Telegram here so the
 * engines never grow channel-specific code.
 */

export async function notifyTrigger(kv, userId, record) {
  await Promise.allSettled([
    sendPush(kv, userId, record),
    sendTelegram(kv, userId, record),
  ])
}

function fmtPrice(record) {
  return record.priceUsd >= 1
    ? record.priceUsd.toFixed(2)
    : (record.priceUsd > 0 ? record.priceUsd.toPrecision(4) : '0')
}

async function sendPush(kv, userId, record) {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv || !kv) return
  let subs
  try { subs = await kv.hgetall(`push:subs:${userId}`) } catch { return }
  if (!subs || Object.keys(subs).length === 0) return

  const { default: webpush } = await import('web-push')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:info@spectreai.io', pub, priv)

  const price = fmtPrice(record)
  const payload = JSON.stringify({
    title: record.name || 'Price alert',
    body: `Triggered at $${price}`,
    url: `/#token/${record.tokenAddress}`,
    tag: record.id,
  })

  await Promise.allSettled(Object.entries(subs).map(async ([endpoint, raw]) => {
    let sub
    try { sub = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return }
    try {
      // timeout keeps a hung push endpoint inside the caller's time budget
      await webpush.sendNotification(sub, payload, { TTL: 3600, timeout: 2000 })
    } catch (err) {
      const code = err?.statusCode
      if (code === 404 || code === 410) {
        try { await kv.hdel(`push:subs:${userId}`, endpoint) } catch { /* noop */ }
      } else {
        console.warn('[alert-notify] push send failed:', code, err?.message)
      }
    }
  }))
}

async function sendTelegram(kv, userId, record) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token || !kv) return
  let chatId
  try { chatId = await kv.get(`tg:chat:${userId}`) } catch { return }
  if (!chatId) return

  const price = fmtPrice(record)
  const text = `${record.name || 'Price alert'}\nTriggered at $${price}\nhttps://trade.spectreai.io/#token/${record.tokenAddress}`

  let res
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(3000),
    })
  } catch (err) {
    console.warn('[alert-notify] telegram send failed:', err?.message)
    return
  }

  let data
  try { data = await res.json() } catch { data = null }

  if (data && data.ok === false) {
    if (data.error_code === 403) {
      try {
        await kv.del(`tg:chat:${userId}`)
        await kv.del(`tg:user:${chatId}`)
      } catch { /* noop */ }
    } else {
      console.warn('[alert-notify] telegram send failed:', data.error_code, data.description)
    }
  }
}
