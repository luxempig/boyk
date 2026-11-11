/**
 * Generate a branded share image for a boycotted scan result.
 * Returns a Blob (PNG). Uses only Canvas API — no external deps.
 */
export async function generateShareImage({ companyName, productName, boycottName, reason }) {
  const W = 1080
  const H = 1080
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  // Background gradient
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#0d0d0f')
  bg.addColorStop(1, '#1a1a1e')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // Accent border
  ctx.strokeStyle = '#f472b6'
  ctx.lineWidth = 6
  ctx.strokeRect(40, 40, W - 80, H - 80)

  // Inner subtle border
  ctx.strokeStyle = 'rgba(244, 114, 182, 0.15)'
  ctx.lineWidth = 1
  ctx.strokeRect(60, 60, W - 120, H - 120)

  // Warning icon circle
  ctx.beginPath()
  ctx.arc(W / 2, 200, 60, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(244, 114, 182, 0.15)'
  ctx.fill()
  ctx.beginPath()
  ctx.arc(W / 2, 200, 60, 0, Math.PI * 2)
  ctx.strokeStyle = '#f472b6'
  ctx.lineWidth = 3
  ctx.stroke()

  // Shield icon (simplified)
  ctx.fillStyle = '#f472b6'
  ctx.font = 'bold 48px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('!', W / 2, 218)

  // "BOYCOTTED" header
  ctx.fillStyle = '#f472b6'
  ctx.font = 'bold 72px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText('BOYCOTTED', W / 2, 340)

  // Divider line
  ctx.strokeStyle = 'rgba(255,255,255,0.1)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(200, 380)
  ctx.lineTo(W - 200, 380)
  ctx.stroke()

  // Company name
  ctx.fillStyle = '#fafafa'
  ctx.font = 'bold 48px system-ui, -apple-system, sans-serif'
  const companyLines = wrapText(ctx, companyName || 'Unknown Company', W - 200)
  let y = 450
  for (const line of companyLines) {
    ctx.fillText(line, W / 2, y)
    y += 58
  }

  // Product name (if from barcode)
  if (productName) {
    y += 10
    ctx.fillStyle = '#a1a1aa'
    ctx.font = '32px system-ui, -apple-system, sans-serif'
    const productLines = wrapText(ctx, productName, W - 200)
    for (const line of productLines) {
      ctx.fillText(line, W / 2, y)
      y += 40
    }
  }

  // Divider
  y += 30
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath()
  ctx.moveTo(200, y)
  ctx.lineTo(W - 200, y)
  ctx.stroke()
  y += 40

  // Boycott name
  if (boycottName) {
    ctx.fillStyle = '#f9a8d4'
    ctx.font = 'bold 32px system-ui, -apple-system, sans-serif'
    ctx.fillText(boycottName, W / 2, y)
    y += 50
  }

  // Reason
  if (reason) {
    ctx.fillStyle = '#71717a'
    ctx.font = '28px system-ui, -apple-system, sans-serif'
    const reasonLines = wrapText(ctx, reason, W - 240)
    for (const line of reasonLines.slice(0, 3)) {
      ctx.fillText(line, W / 2, y)
      y += 36
    }
  }

  // Bottom branding
  ctx.fillStyle = 'rgba(255,255,255,0.06)'
  ctx.fillRect(40, H - 160, W - 80, 120)

  ctx.fillStyle = '#f472b6'
  ctx.font = 'bold 44px system-ui, -apple-system, sans-serif'
  ctx.fillText('Boyk', W / 2, H - 100)

  ctx.fillStyle = '#71717a'
  ctx.font = '24px system-ui, -apple-system, sans-serif'
  ctx.fillText('Check your products at boyk.org', W / 2, H - 60)

  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let current = ''
  for (const word of words) {
    const test = current ? `${current} ${word}` : word
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current)
      current = word
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Share a boycotted scan result. Uses Web Share API on mobile,
 * falls back to downloading the image on desktop.
 */
export async function shareScanResult({ companyName, productName, boycottName, reason }) {
  const blob = await generateShareImage({ companyName, productName, boycottName, reason })
  // canvas.toBlob resolves null if encoding fails (e.g. tainted canvas / OOM).
  // Bail rather than constructing a File/object URL from null.
  if (!blob) return 'failed'
  const file = new File([blob], 'boycotted.png', { type: 'image/png' })

  const shareText = [
    `${companyName} is BOYCOTTED`,
    boycottName ? `Boycott: ${boycottName}` : null,
    reason ? reason : null,
    '',
    'Check your products at boyk.org',
  ]
    .filter(Boolean)
    .join('\n')

  // Try native share with image
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ text: shareText, files: [file] })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
    }
  }

  // Fallback: try text-only share
  if (navigator.share) {
    try {
      await navigator.share({ text: shareText, url: 'https://boyk.org' })
      return 'shared'
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled'
    }
  }

  // Final fallback: download image
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'boycotted.png'
  a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}
