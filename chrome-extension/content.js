// Content script for Boyk Chrome Extension
// Displays warnings when visiting boycotted websites and detects products on Amazon

;(function () {
  'use strict'

  let warningBanner = null
  let isMinimized = false
  let amazonCheckComplete = false

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SHOW_WARNING') {
      showWarningBanner(message.company)
    } else if (message.type === 'BRAND_CHECK_RESULT') {
      if (message.isBoycotted) {
        showWarningBanner(message.company)
      }
    }
    return true
  })

  // Check if we're on Amazon and extract product info
  function isAmazonProductPage() {
    const hostname = window.location.hostname
    return (
      hostname.includes('amazon.') &&
      (window.location.pathname.includes('/dp/') ||
        window.location.pathname.includes('/gp/product/') ||
        window.location.pathname.includes('/product/'))
    )
  }

  // Extract brand/manufacturer from Amazon product page
  function extractAmazonBrand() {
    const brandSelectors = [
      '#bylineInfo', // "Visit the [Brand] Store" or "Brand: [Brand]"
      '#brand', // Direct brand element
      '.po-brand .po-break-word', // Product overview brand
      '#productOverview_feature_div tr:contains("Brand") td:last-child',
      'a#bylineInfo',
    ]

    for (const selector of brandSelectors) {
      try {
        const element = document.querySelector(selector)
        if (element) {
          let brandText = element.textContent.trim()

          // Clean up common Amazon brand text patterns
          brandText = brandText
            .replace(/Visit the\s+/i, '')
            .replace(/\s+Store$/i, '')
            .replace(/Brand:\s*/i, '')
            .replace(/by\s+/i, '')
            .trim()

          if (brandText && brandText.length > 0 && brandText.length < 100) {
            return brandText
          }
        }
      } catch (e) {
        // Selector failed, try next
      }
    }

    // Try extracting from detail bullets
    const detailBullets = document.querySelectorAll(
      '#detailBullets_feature_div li, #productDetails_techSpec_section_1 tr'
    )
    for (const bullet of detailBullets) {
      const text = bullet.textContent || ''
      const brandMatch = text.match(/(?:Brand|Manufacturer|Made by)[:\s]+([^,\n]+)/i)
      if (brandMatch) {
        return brandMatch[1].trim()
      }
    }

    // Try the product title for brand hints (first word is often the brand)
    const titleEl = document.querySelector('#productTitle')
    if (titleEl) {
      const title = titleEl.textContent.trim()
      const firstWord = title.split(/\s+/)[0]
      if (firstWord && firstWord.length > 2 && firstWord.length < 30) {
        // Return with lower confidence flag
        return { name: firstWord, lowConfidence: true }
      }
    }

    return null
  }

  // Check Amazon product brand against boycott list
  async function checkAmazonProduct() {
    if (amazonCheckComplete) return
    amazonCheckComplete = true

    if (!isAmazonProductPage()) return

    const brand = extractAmazonBrand()
    if (!brand) return

    const brandName = typeof brand === 'string' ? brand : brand.name
    const isLowConfidence = typeof brand === 'object' && brand.lowConfidence

    console.log(
      'Boyk: Detected Amazon product brand:',
      brandName,
      isLowConfidence ? '(low confidence)' : ''
    )

    try {
      // Send brand to background script for checking
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_BRAND',
        brand: brandName,
        isLowConfidence,
        url: window.location.href,
      })

      if (response && response.isBoycotted) {
        showWarningBanner({
          ...response.company,
          isAmazonProduct: true,
          productBrand: brandName,
        })
      }
    } catch (error) {
      console.log('Boyk: Could not check brand:', error.message)
    }
  }

  // Escape dynamic values before they reach innerHTML. Boycott/company names are
  // user-authored (a malicious boycott name like '<img src=x onerror=...>' would
  // otherwise execute in every matching page), and productBrand is scraped from
  // the visited page DOM — both are untrusted. Mirrors popup.js's escapeHtml.
  function escapeHtml(text) {
    if (!text) return ''
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  // Create and show the warning banner
  function showWarningBanner(company) {
    // Remove existing banner if any
    if (warningBanner) {
      warningBanner.remove()
    }

    // Create banner container
    warningBanner = document.createElement('div')
    warningBanner.id = 'boyk-warning-banner'
    warningBanner.setAttribute('role', 'alert')

    // Determine the message. Every interpolated value is escaped at build time
    // because `message` is assigned to innerHTML below; the literal <strong>
    // wrappers stay as HTML, only the dynamic values are neutralized.
    const companyName = escapeHtml(company?.name || 'This company')
    const proxyType = escapeHtml(company?.proxyType)
    const parentCompany = escapeHtml(company?.parentCompany)
    const boycottName = escapeHtml(company?.boycott_name)
    let message = ''

    if (company?.isAmazonProduct) {
      // Amazon product: "This product is made by [Brand] which is on your boycott list"
      // Compute brandName from the raw source and escape once (avoids double-encoding).
      const brandName = escapeHtml(company.productBrand || company?.name || 'This company')
      if (company.isProxy) {
        message = `This product is made by <strong>${brandName}</strong> (${proxyType} ${parentCompany})`
      } else if (company.boycott_name) {
        message = `This product is made by <strong>${brandName}</strong>, which is in your "${boycottName}" boycott`
      } else {
        message = `This product is made by <strong>${brandName}</strong>, which is on your boycott list`
      }
    } else if (company?.isProxy) {
      // Proxy company: "Whole Foods (subsidiary of Amazon) is on your boycott list"
      message = `<strong>${companyName}</strong> (${proxyType} ${parentCompany}) is on your boycott list`
    } else if (company?.boycott_name) {
      // Direct company: "Amazon is in your 'assholes' boycott"
      message = `<strong>${companyName}</strong> is in your "${boycottName}" boycott`
    } else {
      message = `<strong>${companyName}</strong> is on your boycott list`
    }

    // Use shopping bag icon for Amazon products, warning triangle for websites
    const icon = company?.isAmazonProduct
      ? `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
          <line x1="3" y1="6" x2="21" y2="6"/>
          <path d="M16 10a4 4 0 0 1-8 0"/>
          <line x1="12" y1="12" x2="12" y2="16"/>
          <line x1="10" y1="14" x2="14" y2="14"/>
        </svg>`
      : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`

    const title = company?.isAmazonProduct ? 'Product Warning' : 'Boycott Warning'

    warningBanner.innerHTML = `
      <div class="boyk-banner-content">
        <div class="boyk-banner-icon">
          ${icon}
        </div>
        <div class="boyk-banner-text">
          <strong>${title}</strong>
          <span>${message}</span>
        </div>
        <div class="boyk-banner-actions">
          <button class="boyk-btn-minimize" title="Minimize">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="boyk-banner-minimized">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>${title}</span>
      </div>
    `

    // Add to page
    document.documentElement.appendChild(warningBanner)

    // Restore minimized state if it was minimized before
    if (isMinimized) {
      warningBanner.classList.add('boyk-minimized')
    }

    // Handle minimize button - toggle minimize state
    const minimizeBtn = warningBanner.querySelector('.boyk-btn-minimize')
    minimizeBtn.addEventListener('click', e => {
      e.stopPropagation()
      toggleMinimize()
    })

    // Click on minimized banner to expand
    warningBanner.addEventListener('click', () => {
      if (isMinimized) {
        toggleMinimize()
      }
    })
  }

  function toggleMinimize() {
    if (warningBanner) {
      isMinimized = !isMinimized
      if (isMinimized) {
        warningBanner.classList.add('boyk-minimized')
      } else {
        warningBanner.classList.remove('boyk-minimized')
      }
    }
  }

  // Check on page load if we should show warning
  async function checkCurrentPage() {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CHECK_URL',
        url: window.location.href,
      })

      if (response && response.isBoycotted) {
        showWarningBanner(response.company)
      } else if (isAmazonProductPage()) {
        // If we're on Amazon and the site itself isn't blocked, check the product
        // Wait a bit for the page to fully load product details
        setTimeout(checkAmazonProduct, 1000)
      }
    } catch (error) {
      // Extension context might be invalidated
      console.log('Boyk: Could not check page')
    }
  }

  // Watch for Amazon SPA navigation (Amazon uses dynamic page loads)
  function watchAmazonNavigation() {
    if (!window.location.hostname.includes('amazon.')) return

    // Reset check flag on URL change
    let lastUrl = window.location.href
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href
        amazonCheckComplete = false

        // Remove old banner
        if (warningBanner) {
          warningBanner.remove()
          warningBanner = null
        }

        // Check the new page
        setTimeout(checkCurrentPage, 500)
      }
    })

    observer.observe(document.body, { childList: true, subtree: true })

    // Disconnect on page unload to prevent memory leaks
    window.addEventListener('beforeunload', () => observer.disconnect(), { once: true })
  }

  // Run check when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      checkCurrentPage()
      watchAmazonNavigation()
    })
  } else {
    // Small delay to ensure extension is ready
    setTimeout(() => {
      checkCurrentPage()
      watchAmazonNavigation()
    }, 500)
  }
})()
