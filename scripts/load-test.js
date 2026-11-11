// Usage:
//   k6 run scripts/load-test.js
//   k6 run scripts/load-test.js --env BASE_URL=http://localhost:3001/api
//
// Install k6: brew install k6 (macOS) or https://k6.io/docs/get-started/installation/

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate, Trend } from 'k6/metrics'

const errorRate = new Rate('errors')
const searchLatency = new Trend('search_latency', true)
const detailLatency = new Trend('detail_latency', true)

const BASE_URL = __ENV.BASE_URL || 'https://boyk.org/neo4j-api/api'

const SEARCH_TERMS = [
  'apple',
  'google',
  'amazon',
  'microsoft',
  'nestle',
  'coca cola',
  'nike',
  'walmart',
  'samsung',
  'toyota',
  'shell',
  'exxon',
  'bp',
  'chevron',
  'meta',
  'tesla',
  'boeing',
  'lockheed',
  'raytheon',
  'pfizer',
]

const COMPANY_IDS = [
  '5493006MHB84DD0ZWV18', // Apple (LEI)
  '549300WDTPKXJORN4M23', // Google/Alphabet
  'Q312', // Starbucks (Wikidata)
  'Q95', // Google (Wikidata)
]

export const options = {
  scenarios: {
    // Scenario 1: Baseline — steady browsing
    baseline: {
      executor: 'constant-vus',
      vus: 100,
      duration: '5m',
      startTime: '0s',
    },
    // Scenario 2: Spike — viral event
    spike: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: 100 },
        { duration: '1m', target: 1000 },
        { duration: '2m', target: 1000 },
        { duration: '30s', target: 100 },
      ],
      startTime: '5m',
    },
    // Scenario 3: Sustained load
    sustained: {
      executor: 'constant-vus',
      vus: 500,
      duration: '10m',
      startTime: '9m',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // p95 < 500ms
    errors: ['rate<0.01'], // Error rate < 1%
    search_latency: ['p(95)<400'],
    detail_latency: ['p(95)<600'],
  },
}

export default function () {
  // Mix of search (60%) and detail page (40%) requests
  if (Math.random() < 0.6) {
    const term = SEARCH_TERMS[Math.floor(Math.random() * SEARCH_TERMS.length)]
    const start = Date.now()
    const res = http.get(`${BASE_URL}/companies/search?q=${encodeURIComponent(term)}&limit=20`)
    searchLatency.add(Date.now() - start)

    const ok = check(res, {
      'search status 200': r => r.status === 200,
      'search returns array': r => {
        try {
          return Array.isArray(JSON.parse(r.body))
        } catch {
          return false
        }
      },
    })
    errorRate.add(!ok)
  } else {
    const id = COMPANY_IDS[Math.floor(Math.random() * COMPANY_IDS.length)]
    const start = Date.now()
    const res = http.get(`${BASE_URL}/companies/${id}`)
    detailLatency.add(Date.now() - start)

    const ok = check(res, {
      'detail status 200': r => r.status === 200,
      'detail has name': r => {
        try {
          return JSON.parse(r.body).name !== undefined
        } catch {
          return false
        }
      },
    })
    errorRate.add(!ok)
  }

  sleep(Math.random() * 2 + 0.5) // 0.5-2.5s between requests
}
