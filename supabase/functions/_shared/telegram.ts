/**
 * Send a Telegram notification via Bot API.
 */
export async function sendTelegram(message: string) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')
  const chatId = Deno.env.get('TELEGRAM_CHAT_ID')

  if (!token || !chatId) {
    console.warn('Telegram credentials not configured, skipping notification')
    return
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      console.error(`Telegram send failed (${res.status}): ${body}`)
    }
  } catch (err) {
    console.error('Telegram send error:', err)
  }
}
