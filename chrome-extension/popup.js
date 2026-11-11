// Supabase configuration (placeholders replaced at build time; see scripts/build-extension.sh)
const SUPABASE_URL = '__SUPABASE_URL__'
const SUPABASE_ANON_KEY = '__SUPABASE_ANON_KEY__'

// Neo4j API for company lookups (proxied through Cloudflare Worker, Access bypassed)
const NEO4J_API_URL = 'https://boyk.org/neo4j-api'

// DOM Elements
const loadingEl = document.getElementById('loading')
const loginSection = document.getElementById('login-section')
const dashboard = document.getElementById('dashboard')
const loginForm = document.getElementById('login-form')
const loginError = document.getElementById('login-error')
const loginBtn = document.getElementById('login-btn')
const logoutBtn = document.getElementById('logout-btn')
const userEmail = document.getElementById('user-email')
const userAvatar = document.getElementById('user-avatar')
const boycottCount = document.getElementById('boycott-count')
const companyCount = document.getElementById('company-count')
const proxyCount = document.getElementById('proxy-count')
const notificationsToggle = document.getElementById('notifications-toggle')
const currentSite = document.getElementById('current-site')
const statusIcon = document.getElementById('status-icon')
const statusText = document.getElementById('status-text')
const siteCompany = document.getElementById('site-company')
const refreshBtn = document.getElementById('refresh-btn')
const refreshText = document.getElementById('refresh-text')
const refreshSpinner = document.getElementById('refresh-spinner')
const lastSync = document.getElementById('last-sync')
const companySearch = document.getElementById('company-search')
const searchResults = document.getElementById('search-results')
const searchSpinner = document.getElementById('search-spinner')
const googleSignInBtn = document.getElementById('google-signin-btn')

// Listen for session changes (e.g., Google OAuth completing while popup was closed)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.session?.newValue) {
    const session = changes.session.newValue
    if (session.access_token && session.user) {
      showDashboard(session.user)
      checkCurrentTab()
    }
  }
})

// Initialize popup
document.addEventListener('DOMContentLoaded', init)

async function init() {
  // Check for existing session
  const { session } = await chrome.storage.local.get('session')

  if (session && session.access_token) {
    // Verify session is still valid
    const isValid = await verifySession(session)
    if (isValid) {
      showDashboard(session.user)
      await checkCurrentTab()
    } else {
      showLogin()
    }
  } else {
    showLogin()
  }
}

function showLogin() {
  loadingEl.classList.add('hidden')
  loginSection.classList.remove('hidden')
  dashboard.classList.add('hidden')
}

async function showDashboard(user) {
  loadingEl.classList.add('hidden')
  loginSection.classList.add('hidden')
  dashboard.classList.remove('hidden')

  // Set user info
  userEmail.textContent = user.email
  userAvatar.textContent = user.email.charAt(0).toUpperCase()

  // Load settings
  const { notificationsEnabled } = await chrome.storage.local.get('notificationsEnabled')
  notificationsToggle.checked = notificationsEnabled !== false

  // Load boycott stats
  await loadBoycottStats()

  // Update last sync time
  updateLastSync()
}

async function verifySession(session) {
  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    })
    return response.ok
  } catch {
    return false
  }
}

// Login handler
loginForm.addEventListener('submit', async e => {
  e.preventDefault()

  let identifier = document.getElementById('email').value.trim().toLowerCase()
  const password = document.getElementById('password').value

  loginBtn.disabled = true
  loginBtn.textContent = 'Signing in...'
  loginError.classList.add('hidden')

  try {
    // If no @ sign, treat as username and look up email via RPC
    let email = identifier
    if (!identifier.includes('@')) {
      const lookupRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_email_by_username`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ p_username: identifier }),
      })
      const foundEmail = await lookupRes.json()
      if (!lookupRes.ok || !foundEmail) {
        throw new Error('Invalid username or password')
      }
      email = foundEmail
    }

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    })

    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error_description || data.msg || 'Invalid credentials')
    }

    // Save session
    await chrome.storage.local.set({
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        user: data.user,
      },
    })

    // Fetch boycott data
    await fetchBoycottData(data.access_token, data.user.id)

    showDashboard(data.user)
    await checkCurrentTab()
  } catch (error) {
    loginError.textContent = error.message
    loginError.classList.remove('hidden')
  } finally {
    loginBtn.disabled = false
    loginBtn.textContent = 'Sign In'
  }
})

// Google sign-in handler
googleSignInBtn.addEventListener('click', async () => {
  googleSignInBtn.disabled = true
  googleSignInBtn.textContent = 'Signing in...'
  loginError.classList.add('hidden')

  chrome.runtime.sendMessage({ type: 'GOOGLE_SIGNIN' }, async response => {
    googleSignInBtn.disabled = false
    // Restore button content using DOM (safe, no innerHTML)
    googleSignInBtn.textContent = ''
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '18')
    svg.setAttribute('height', '18')
    svg.setAttribute('viewBox', '0 0 24 24')
    const paths = [
      {
        d: 'M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z',
        fill: '#4285F4',
      },
      {
        d: 'M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z',
        fill: '#34A853',
      },
      {
        d: 'M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z',
        fill: '#FBBC05',
      },
      {
        d: 'M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z',
        fill: '#EA4335',
      },
    ]
    for (const p of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
      path.setAttribute('d', p.d)
      path.setAttribute('fill', p.fill)
      svg.appendChild(path)
    }
    googleSignInBtn.appendChild(svg)
    googleSignInBtn.appendChild(document.createTextNode('Continue with Google'))

    if (!response) {
      loginError.textContent = 'Could not connect to extension. Try again.'
      loginError.classList.remove('hidden')
      return
    }

    if (response.cancelled) {
      // User closed the window — not an error, just reset
      return
    }

    if (response.success) {
      await fetchBoycottData(response.session.access_token, response.session.user.id)
      showDashboard(response.session.user)
      await checkCurrentTab()
    } else if (response.error) {
      loginError.textContent = response.error
      loginError.classList.remove('hidden')
    }
  })
})

// Logout handler
logoutBtn.addEventListener('click', async () => {
  const { session } = await chrome.storage.local.get('session')

  // Server-side logout (best effort)
  if (session?.access_token) {
    fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    }).catch(() => {})
  }

  await chrome.storage.local.remove(['session', 'boycottData', 'lastSync'])
  showLogin()

  // Notify background script
  chrome.runtime.sendMessage({ type: 'LOGOUT' })
})

// Notifications toggle
notificationsToggle.addEventListener('change', async () => {
  await chrome.storage.local.set({ notificationsEnabled: notificationsToggle.checked })

  // Notify background script
  chrome.runtime.sendMessage({
    type: 'SETTINGS_CHANGED',
    notificationsEnabled: notificationsToggle.checked,
  })
})

// Open Web App button
const openAppBtn = document.getElementById('open-app-btn')
openAppBtn.addEventListener('click', async () => {
  const { session } = await chrome.storage.local.get('session')
  if (session && session.access_token) {
    // Pass session via hash fragment so web app can restore it
    const params = new URLSearchParams({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      type: 'extension',
    })
    chrome.tabs.create({ url: `https://boyk.org/#${params.toString()}` })
  } else {
    chrome.tabs.create({ url: 'https://boyk.org/' })
  }
})

// Refresh button
refreshBtn.addEventListener('click', async () => {
  refreshText.textContent = 'Refreshing...'
  refreshSpinner.classList.remove('hidden')
  refreshBtn.disabled = true

  try {
    const { session } = await chrome.storage.local.get('session')
    if (session) {
      await fetchBoycottData(session.access_token, session.user.id)
      await loadBoycottStats()
      await checkCurrentTab()
      updateLastSync()
    }
  } catch (error) {
    console.error('Refresh failed:', error)
  } finally {
    refreshText.textContent = 'Refresh boycott list'
    refreshSpinner.classList.add('hidden')
    refreshBtn.disabled = false
  }
})

async function fetchBoycottData(accessToken, userId) {
  try {
    // Fetch both user's own boycotts AND adopted boycotts
    const [myBoycottsResponse, followedBoycottsResponse] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/rpc/get_my_boycotts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ p_user_id: userId }),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/rpc/get_followed_boycotts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ p_user_id: userId }),
      }),
    ])

    const myBoycottsText = await myBoycottsResponse.text()
    const followedBoycottsText = await followedBoycottsResponse.text()

    let myBoycotts = []
    let followedBoycotts = []

    try {
      myBoycotts = JSON.parse(myBoycottsText)
    } catch (e) {
      console.error('Failed to parse myBoycotts:', e)
    }

    try {
      followedBoycotts = JSON.parse(followedBoycottsText)
    } catch (e) {
      console.error('Failed to parse followedBoycotts:', e)
    }

    // Ensure arrays (API might return null or error object)
    if (!Array.isArray(myBoycotts)) {
      myBoycotts = []
    }
    if (!Array.isArray(followedBoycotts)) {
      followedBoycotts = []
    }

    // Combine both lists (avoid duplicates by ID)
    const seenIds = new Set()
    const boycotts = []
    for (const b of [...myBoycotts, ...followedBoycotts]) {
      if (!seenIds.has(b.id)) {
        seenIds.add(b.id)
        boycotts.push(b)
      }
    }

    // Extract all companies with their websites
    const companies = []
    const domains = new Set()

    for (const boycott of boycotts) {
      const boycottCompanies = boycott.boycott_companies || []
      for (const bc of boycottCompanies) {
        if (bc.companies) {
          const company = bc.companies
          companies.push({
            id: company.id,
            name: company.name,
            website: company.website,
            logo_url: company.logo_url,
            boycott_name: boycott.name,
          })

          // Extract domain from website
          if (company.website) {
            try {
              const url = new URL(company.website)
              const domain = url.hostname.replace('www.', '')
              domains.add(domain)

              // Also add www variation
              domains.add(`www.${domain}`)
            } catch {}
          }
        }
      }
    }

    // Also fetch proxy companies (subsidiaries, parents, suppliers)
    // Build a map of company ID -> blocking settings from the boycott entries
    const companyBlockSettings = new Map()
    for (const boycott of boycotts) {
      for (const bc of boycott.boycott_companies || []) {
        if (bc.companies) {
          const existing = companyBlockSettings.get(bc.companies.id) || {
            block_owns: false,
            block_owned_by: false,
            block_suppliers: false,
          }
          // Merge settings (if any boycott has a flag enabled, it's enabled)
          companyBlockSettings.set(bc.companies.id, {
            block_owns: existing.block_owns || bc.block_owns,
            block_owned_by: existing.block_owned_by || bc.block_owned_by,
            block_suppliers: existing.block_suppliers || bc.block_suppliers,
          })
        }
      }
    }

    // Get all company IDs that have at least one proxy block enabled
    const companyIds = companies.map(c => c.id)
    const directCompanyIdSet = new Set(companyIds)
    const companiesWithProxyBlocks = companyIds.filter(id => {
      const settings = companyBlockSettings.get(id)
      return (
        settings && (settings.block_owns || settings.block_owned_by || settings.block_suppliers)
      )
    })

    if (companiesWithProxyBlocks.length > 0) {
      // Fetch connections with both source and target company info
      const proxyResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/company_connections?or=(source_company_id.in.(${companiesWithProxyBlocks.join(',')}),target_company_id.in.(${companiesWithProxyBlocks.join(',')}))&select=source_company_id,target_company_id,connection_type,source_company:source_company_id(id,name,website),target_company:target_company_id(id,name,website)`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
        }
      )

      if (proxyResponse.ok) {
        const connections = await proxyResponse.json()
        const addedProxyIds = new Set()

        for (const conn of connections) {
          // Determine which company is the proxy (the one NOT in our direct list)
          // and which is the "parent" (the one IN our direct list)
          let proxyCompany = null
          let parentCompanyId = null
          let parentCompanyName = null
          let relationshipType = conn.connection_type
          let shouldInclude = false

          if (
            directCompanyIdSet.has(conn.source_company_id) &&
            !directCompanyIdSet.has(conn.target_company_id)
          ) {
            // Direct company is source, target is the proxy
            // e.g., "Starbucks owns Teavana" -> Teavana is proxy, Starbucks is parent
            proxyCompany = conn.target_company
            parentCompanyId = conn.source_company_id
            parentCompanyName = conn.source_company?.name

            // Check if we should include this based on block settings
            const settings = companyBlockSettings.get(parentCompanyId)
            if (relationshipType === 'owns' && settings?.block_owns) {
              // Source owns target -> target is subsidiary -> only include if block_owns is enabled
              relationshipType = 'subsidiary of'
              shouldInclude = true
            } else if (relationshipType === 'supplier' && settings?.block_suppliers) {
              // Source has target as supplier -> include if block_suppliers is enabled
              shouldInclude = true
            }
          } else if (
            directCompanyIdSet.has(conn.target_company_id) &&
            !directCompanyIdSet.has(conn.source_company_id)
          ) {
            // Direct company is target, source is the proxy
            proxyCompany = conn.source_company
            parentCompanyId = conn.target_company_id
            parentCompanyName = conn.target_company?.name

            // Check if we should include this based on block settings
            const settings = companyBlockSettings.get(parentCompanyId)
            if (relationshipType === 'owns' && settings?.block_owned_by) {
              // Source owns target (our direct company) -> source is parent -> only include if block_owned_by is enabled
              relationshipType = 'parent of'
              shouldInclude = true
            } else if (relationshipType === 'supplier' && settings?.block_suppliers) {
              // Source supplies to target (our direct company) -> include if block_suppliers is enabled
              shouldInclude = true
            }
          }

          // Skip if we shouldn't include this connection based on settings
          if (!shouldInclude) {
            continue
          }

          // Skip if no valid proxy company, already added, or is already a direct company
          if (
            !proxyCompany ||
            !proxyCompany.website ||
            addedProxyIds.has(proxyCompany.id) ||
            directCompanyIdSet.has(proxyCompany.id)
          ) {
            continue
          }

          try {
            const url = new URL(proxyCompany.website)
            const domain = url.hostname.replace('www.', '')
            domains.add(domain)
            domains.add(`www.${domain}`)

            // Add to companies list for display
            companies.push({
              id: proxyCompany.id,
              name: proxyCompany.name,
              website: proxyCompany.website,
              isProxy: true,
              proxyType: relationshipType,
              parentCompany: parentCompanyName,
            })

            addedProxyIds.add(proxyCompany.id)
          } catch {}
        }
      }
    }

    const directCompanyCount = companies.filter(c => !c.isProxy).length
    const proxyCompanyCount = companies.filter(c => c.isProxy).length

    const boycottData = {
      boycotts,
      companies,
      domains: Array.from(domains),
      boycottCount: boycotts.length,
      directCompanyCount,
      proxyCompanyCount,
      companyCount: companies.length,
    }

    await chrome.storage.local.set({
      boycottData,
      lastSync: Date.now(),
    })

    // Notify background script
    chrome.runtime.sendMessage({
      type: 'BOYCOTT_DATA_UPDATED',
      domains: boycottData.domains,
    })

    return boycottData
  } catch (error) {
    console.error('Error fetching boycott data:', error)
    throw error
  }
}

async function loadBoycottStats() {
  const { boycottData } = await chrome.storage.local.get('boycottData')

  if (boycottData) {
    boycottCount.textContent = boycottData.boycottCount || 0
    companyCount.textContent = boycottData.directCompanyCount || 0
    proxyCount.textContent = boycottData.proxyCompanyCount || 0
  }
}

function updateLastSync() {
  chrome.storage.local.get('lastSync', ({ lastSync: syncTime }) => {
    if (syncTime) {
      const date = new Date(syncTime)
      const now = new Date()
      const diff = now - date

      let timeAgo
      if (diff < 60000) {
        timeAgo = 'Just now'
      } else if (diff < 3600000) {
        timeAgo = `${Math.floor(diff / 60000)} min ago`
      } else if (diff < 86400000) {
        timeAgo = `${Math.floor(diff / 3600000)} hours ago`
      } else {
        timeAgo = date.toLocaleDateString()
      }

      lastSync.textContent = `Last synced: ${timeAgo}`
    }
  })
}

// Company search via Neo4j API
let searchTimeout = null

companySearch.addEventListener('input', () => {
  clearTimeout(searchTimeout)
  const query = companySearch.value.trim()

  if (query.length < 2) {
    searchResults.classList.add('hidden')
    searchResults.innerHTML = ''
    searchSpinner.classList.add('hidden')
    return
  }

  searchSpinner.classList.remove('hidden')
  searchTimeout = setTimeout(() => searchCompanies(query), 300)
})

async function searchCompanies(query) {
  try {
    const response = await fetch(
      `${NEO4J_API_URL}/api/companies/search?q=${encodeURIComponent(query)}&limit=5`
    )

    if (!response.ok) throw new Error('Search failed')

    const companies = await response.json()
    searchSpinner.classList.add('hidden')

    if (companies.length === 0) {
      searchResults.innerHTML = '<div class="search-empty">No companies found</div>'
      searchResults.classList.remove('hidden')
      return
    }

    // Check which companies are in boycott list
    const { boycottData } = await chrome.storage.local.get('boycottData')
    const boycottedNames = new Set((boycottData?.companies || []).map(c => c.name?.toLowerCase()))

    searchResults.innerHTML = companies
      .map(c => {
        const isBoycotted = boycottedNames.has(c.name?.toLowerCase())
        const badge = isBoycotted ? '<span class="search-badge boycotted">BOYCOTTED</span>' : ''
        const country = c.country
          ? `<span class="search-country">${escapeHtml(c.country)}</span>`
          : ''
        const industry = c.industry
          ? `<span class="search-industry">${escapeHtml(c.industry)}</span>`
          : ''
        const companyId = escapeHtml(c.id || '')

        return `
          <div class="search-result ${isBoycotted ? 'is-boycotted' : ''}" data-company-id="${companyId}" data-company-name="${escapeHtml(c.name)}">
            <div class="search-result-header">
              <span class="search-result-name">${escapeHtml(c.name)}</span>
              ${badge}
            </div>
            <div class="search-result-meta">${country}${industry}</div>
          </div>
        `
      })
      .join('')

    // Add click handlers to open company in web app
    searchResults.querySelectorAll('.search-result').forEach(el => {
      el.addEventListener('click', () => {
        const companyId = el.dataset.companyId
        if (companyId) {
          chrome.tabs.create({ url: `https://boyk.org/company/${companyId}` })
        }
      })
    })

    searchResults.classList.remove('hidden')
  } catch (error) {
    searchSpinner.classList.add('hidden')
    searchResults.innerHTML = '<div class="search-empty">Search unavailable</div>'
    searchResults.classList.remove('hidden')
  }
}

function escapeHtml(text) {
  if (!text) return ''
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

async function checkCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab || !tab.url) {
      currentSite.classList.add('hidden')
      return
    }

    const { boycottData } = await chrome.storage.local.get('boycottData')

    if (!boycottData || !boycottData.domains) {
      currentSite.classList.add('hidden')
      return
    }

    try {
      const url = new URL(tab.url)
      const hostname = url.hostname.replace('www.', '')

      // Check if current site is boycotted
      const isBoycotted = boycottData.domains.some(domain => {
        const cleanDomain = domain.replace('www.', '')
        return (
          hostname === cleanDomain ||
          hostname.endsWith(`.${cleanDomain}`) ||
          cleanDomain.includes(hostname)
        )
      })

      if (isBoycotted) {
        // Find the matching company
        const company = boycottData.companies.find(c => {
          if (!c.website) return false
          try {
            const companyDomain = new URL(c.website).hostname.replace('www.', '')
            return (
              hostname === companyDomain ||
              hostname.endsWith(`.${companyDomain}`) ||
              companyDomain.includes(hostname)
            )
          } catch {
            return false
          }
        })

        currentSite.classList.remove('hidden')
        statusIcon.className = 'status-icon warning'
        statusText.className = 'status-text warning'
        statusText.textContent = 'BOYCOTTED'

        if (company) {
          if (company.isProxy) {
            siteCompany.textContent = `${company.name} (${company.proxyType} of ${company.parentCompany})`
          } else {
            siteCompany.textContent = `${company.name} - ${company.boycott_name || 'In your boycott list'}`
          }
        } else {
          siteCompany.textContent = hostname
        }
      } else {
        currentSite.classList.remove('hidden')
        statusIcon.className = 'status-icon safe'
        statusText.className = 'status-text safe'
        statusText.textContent = 'SAFE'
        siteCompany.textContent = hostname
      }
    } catch {
      currentSite.classList.add('hidden')
    }
  } catch (error) {
    console.error('Error checking current tab:', error)
    currentSite.classList.add('hidden')
  }
}
