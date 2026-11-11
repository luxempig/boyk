// Background service worker for Boyk Chrome Extension

// Placeholders replaced at build time; see scripts/build-extension.sh
const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'

// --- PKCE helpers for Google OAuth ---

function generateCodeVerifier() {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

async function signInWithGoogle() {
  const redirectUri = chrome.identity.getRedirectURL('supabase-auth')
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)

  // Persist verifier in storage (popup may close during consent screen)
  await chrome.storage.local.set({ pkce_verifier: codeVerifier })

  const authUrl =
    `${SUPABASE_URL}/auth/v1/authorize?` +
    new URLSearchParams({
      provider: 'google',
      redirect_to: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

  const responseUrl = await chrome.identity.launchWebAuthFlow({
    url: authUrl,
    interactive: true,
  })

  const url = new URL(responseUrl)
  const code = url.searchParams.get('code')
  if (!code) throw new Error('No authorization code received')

  // Exchange code for session tokens
  const { pkce_verifier } = await chrome.storage.local.get('pkce_verifier')
  const tokenRes = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: pkce_verifier,
    }),
  })

  if (!tokenRes.ok) {
    const errBody = await tokenRes.json().catch(() => ({}))
    throw new Error(errBody.error_description || errBody.msg || 'Token exchange failed')
  }

  const data = await tokenRes.json()
  const session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    user: data.user,
  }

  await chrome.storage.local.set({ session })
  await chrome.storage.local.remove('pkce_verifier')
  return session
}

// Cache for quick domain lookup
let boycottedDomains = new Set()
let boycottedCompanies = new Map() // domain -> company info
let boycottedBrands = new Map() // normalized brand name -> company info

// Initialize on install/update
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Boyk extension installed')
  await loadBoycottData()
})

// Initialize on startup
chrome.runtime.onStartup.addListener(async () => {
  console.log('Boyk extension started')
  await loadBoycottData()
})

// Normalize brand name for matching
function normalizeBrandName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // Remove non-alphanumeric
    .replace(/\s+/g, '') // Remove spaces
}

// Load boycott data from storage
async function loadBoycottData() {
  const { boycottData } = await chrome.storage.local.get(['boycottData'])

  if (boycottData && boycottData.domains) {
    boycottedDomains = new Set(boycottData.domains.map(d => d.replace('www.', '')))

    // Build company lookup map
    boycottedCompanies.clear()
    boycottedBrands.clear()

    for (const company of boycottData.companies || []) {
      // Index by website domain
      if (company.website) {
        try {
          const domain = new URL(company.website).hostname.replace('www.', '')
          boycottedCompanies.set(domain, company)
        } catch {}
      }

      // Index by company name (for brand matching)
      if (company.name) {
        const normalizedName = normalizeBrandName(company.name)
        boycottedBrands.set(normalizedName, company)

        // Also add common variations
        // e.g., "The Coca-Cola Company" -> "cocacola", "coca-cola", "coke"
        const words = company.name.split(/[\s\-_]+/)
        if (words.length > 1) {
          // Add first word as potential brand
          const firstWord = normalizeBrandName(words[0])
          if (firstWord.length > 2 && !boycottedBrands.has(firstWord)) {
            boycottedBrands.set(firstWord, company)
          }
        }
      }
    }

    console.log(
      `Loaded ${boycottedDomains.size} boycotted domains, ${boycottedBrands.size} brand names`
    )
  }
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'BOYCOTT_DATA_UPDATED':
      loadBoycottData()
      break

    case 'LOGOUT':
      boycottedDomains.clear()
      boycottedCompanies.clear()
      boycottedBrands.clear()
      break

    case 'GOOGLE_SIGNIN':
      signInWithGoogle()
        .then(session => {
          sendResponse({ success: true, session })
          loadBoycottData()
        })
        .catch(err => {
          // User cancelled = not an error worth reporting
          const cancelled =
            err.message?.includes('user did not approve') ||
            err.message?.includes('cancelled') ||
            err.message?.includes('canceled')
          sendResponse({
            success: false,
            error: cancelled ? null : err.message || 'Google sign-in failed',
            cancelled,
          })
        })
      break

    case 'SETTINGS_CHANGED':
      // Settings are stored, no action needed here
      break

    case 'CHECK_URL':
      const urlResult = checkUrl(message.url)
      sendResponse(urlResult)
      break

    case 'CHECK_BRAND':
      const brandResult = checkBrand(message.brand, message.isLowConfidence)
      // Update badge if boycotted
      if (brandResult.isBoycotted && sender.tab) {
        chrome.action.setBadgeText({ text: '!', tabId: sender.tab.id })
        chrome.action.setBadgeBackgroundColor({ color: '#fb7185', tabId: sender.tab.id })
      }
      sendResponse(brandResult)
      break
  }

  return true // Keep channel open for async response
})

// Check if a brand name is boycotted
function checkBrand(brandName, isLowConfidence = false) {
  if (!brandName) return { isBoycotted: false }

  const normalizedInput = normalizeBrandName(brandName)

  // Direct match
  if (boycottedBrands.has(normalizedInput)) {
    return {
      isBoycotted: true,
      company: boycottedBrands.get(normalizedInput),
    }
  }

  // Fuzzy match - check if input contains or is contained by a boycotted brand
  // Skip fuzzy matching for low confidence brand detection
  if (!isLowConfidence) {
    for (const [normalizedBrand, company] of boycottedBrands) {
      // Require both strings to be at least 5 chars to avoid matching short common words
      if (normalizedInput.length < 5 || normalizedBrand.length < 5) continue

      if (normalizedInput.includes(normalizedBrand)) {
        return {
          isBoycotted: true,
          company,
          matchType: 'contains',
        }
      }

      if (normalizedBrand.includes(normalizedInput)) {
        return {
          isBoycotted: true,
          company,
          matchType: 'contained_by',
        }
      }
    }
  }

  return { isBoycotted: false }
}

// Check if a URL is boycotted
function checkUrl(url) {
  try {
    const urlObj = new URL(url)
    const hostname = urlObj.hostname.replace('www.', '')

    // Direct match
    if (boycottedDomains.has(hostname)) {
      return {
        isBoycotted: true,
        company: boycottedCompanies.get(hostname),
      }
    }

    // Check if it's a subdomain of a boycotted domain
    for (const domain of boycottedDomains) {
      if (hostname.endsWith(`.${domain}`) || domain.endsWith(`.${hostname}`)) {
        return {
          isBoycotted: true,
          company: boycottedCompanies.get(domain),
        }
      }
    }

    // Check if domain contains boycotted company name
    // Require at least 5 chars to avoid false positives with short names
    for (const company of boycottedCompanies.values()) {
      const companyNameLower = company.name.toLowerCase().replace(/[^a-z0-9]/g, '')
      const hostnameLower = hostname.toLowerCase().replace(/[^a-z0-9]/g, '')

      if (companyNameLower.length >= 5 && hostnameLower.includes(companyNameLower)) {
        return {
          isBoycotted: true,
          company,
        }
      }
    }

    return { isBoycotted: false }
  } catch {
    return { isBoycotted: false }
  }
}

// Listen for tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    await checkAndNotifyTab(tabId, tab.url)
  }
})

// Listen for tab activation
chrome.tabs.onActivated.addListener(async activeInfo => {
  const tab = await chrome.tabs.get(activeInfo.tabId)
  if (tab.url) {
    await checkAndNotifyTab(activeInfo.tabId, tab.url)
  }
})

// Check tab and send message to content script
async function checkAndNotifyTab(tabId, url) {
  const { session, notificationsEnabled } = await chrome.storage.local.get([
    'session',
    'notificationsEnabled',
  ])

  // Only check if logged in and notifications are enabled
  if (!session || notificationsEnabled === false) {
    return
  }

  const result = checkUrl(url)

  if (result.isBoycotted) {
    // Send message to content script
    try {
      await chrome.tabs.sendMessage(tabId, {
        type: 'SHOW_WARNING',
        company: result.company,
      })
    } catch (error) {
      // Content script might not be loaded yet
      console.log('Could not send message to tab:', error.message)
    }

    // Update extension badge
    chrome.action.setBadgeText({ text: '!', tabId })
    chrome.action.setBadgeBackgroundColor({ color: '#fb7185', tabId })
  } else {
    // Clear badge
    chrome.action.setBadgeText({ text: '', tabId })
  }
}

// Periodic refresh of boycott data (every 30 minutes)
chrome.alarms.create('refreshBoycottData', { periodInMinutes: 30 })

chrome.alarms.onAlarm.addListener(async alarm => {
  if (alarm.name === 'refreshBoycottData') {
    const { session } = await chrome.storage.local.get('session')

    if (session && session.access_token) {
      console.log('Auto-refreshing boycott data...')

      try {
        // Verify session is still valid
        const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_ANON_KEY,
          },
        })

        if (response.ok) {
          // Session still valid, reload data from storage
          await loadBoycottData()
        } else if (session.refresh_token) {
          // Try to refresh the token
          try {
            const refreshResponse = await fetch(
              `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  apikey: SUPABASE_ANON_KEY,
                },
                body: JSON.stringify({ refresh_token: session.refresh_token }),
              }
            )

            if (refreshResponse.ok) {
              const data = await refreshResponse.json()
              await chrome.storage.local.set({
                session: {
                  access_token: data.access_token,
                  refresh_token: data.refresh_token,
                  user: data.user,
                },
              })
              console.log('Session refreshed successfully')
              await loadBoycottData()
            } else {
              // Refresh failed, clear session
              console.log('Token refresh failed, clearing data')
              await chrome.storage.local.remove(['session', 'boycottData'])
              boycottedDomains.clear()
              boycottedCompanies.clear()
              boycottedBrands.clear()
            }
          } catch (refreshError) {
            console.error('Token refresh error:', refreshError)
          }
        } else {
          // Session expired and no refresh token
          console.log('Session expired, clearing data')
          await chrome.storage.local.remove(['session', 'boycottData'])
          boycottedDomains.clear()
          boycottedCompanies.clear()
          boycottedBrands.clear()
        }
      } catch (error) {
        console.error('Auto-refresh failed:', error)
      }
    }
  }
})

// Initial load
loadBoycottData()
