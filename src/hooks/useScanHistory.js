import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'boyk_scan_history'
const MAX_ENTRIES = 200

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function persist(history) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    /* storage full or unavailable */
  }
}

function dateKey(ts) {
  return new Date(ts).toISOString().split('T')[0]
}

function computeStats(history) {
  const totalScans = history.length
  const boycottedFound = history.filter(s => s.hasConflict).length
  const clearFound = totalScans - boycottedFound
  const barcodeScans = history.filter(s => s.type === 'barcode').length

  // Streak: consecutive days with at least one scan
  const scanDays = [...new Set(history.map(s => dateKey(s.timestamp)))].sort().reverse()
  let currentStreak = 0
  const today = dateKey(Date.now())
  const yesterday = dateKey(Date.now() - 86400000)

  if (scanDays[0] === today || scanDays[0] === yesterday) {
    currentStreak = 1
    for (let i = 1; i < scanDays.length; i++) {
      const diff = (new Date(scanDays[i - 1]) - new Date(scanDays[i])) / 86400000
      if (diff === 1) currentStreak++
      else break
    }
  }

  let longestStreak = 0
  let run = 1
  for (let i = 1; i < scanDays.length; i++) {
    const diff = (new Date(scanDays[i - 1]) - new Date(scanDays[i])) / 86400000
    if (diff === 1) run++
    else {
      longestStreak = Math.max(longestStreak, run)
      run = 1
    }
  }
  longestStreak = Math.max(longestStreak, run, currentStreak)

  // Top boycotted companies
  const counts = {}
  history
    .filter(s => s.hasConflict)
    .forEach(s => {
      counts[s.companyName] = (counts[s.companyName] || 0) + 1
    })
  const topBoycotted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }))

  const uniqueCompanies = new Set(history.map(s => s.companyName)).size

  // Rough estimate: avg ~$8 per boycotted product avoided
  const estimatedDiverted = boycottedFound * 8

  const weekAgo = Date.now() - 7 * 86400000
  const thisWeek = history.filter(s => s.timestamp > weekAgo).length
  const boycottedThisWeek = history.filter(s => s.timestamp > weekAgo && s.hasConflict).length

  return {
    totalScans,
    boycottedFound,
    clearFound,
    barcodeScans,
    currentStreak,
    longestStreak,
    topBoycotted,
    uniqueCompanies,
    estimatedDiverted,
    thisWeek,
    boycottedThisWeek,
  }
}

const BADGE_DEFS = [
  {
    id: 'first_scan',
    name: 'First Check',
    desc: 'Complete your first product check',
    check: s => s.totalScans >= 1,
  },
  {
    id: 'scanner_10',
    name: 'Scanner',
    desc: 'Check 10 products',
    check: s => s.totalScans >= 10,
  },
  {
    id: 'scanner_50',
    name: 'Investigator',
    desc: 'Check 50 products',
    check: s => s.totalScans >= 50,
  },
  {
    id: 'scanner_100',
    name: 'Watchdog',
    desc: 'Check 100 products',
    check: s => s.totalScans >= 100,
  },
  {
    id: 'spotter_5',
    name: 'Spotter',
    desc: 'Find 5 boycotted products',
    check: s => s.boycottedFound >= 5,
  },
  {
    id: 'spotter_25',
    name: 'Detector',
    desc: 'Find 25 boycotted products',
    check: s => s.boycottedFound >= 25,
  },
  {
    id: 'streak_3',
    name: 'Consistent',
    desc: '3-day scanning streak',
    check: s => s.longestStreak >= 3,
  },
  {
    id: 'streak_7',
    name: 'Dedicated',
    desc: '7-day scanning streak',
    check: s => s.longestStreak >= 7,
  },
  {
    id: 'streak_30',
    name: 'Champion',
    desc: '30-day scanning streak',
    check: s => s.longestStreak >= 30,
  },
  {
    id: 'diverse_10',
    name: 'Explorer',
    desc: 'Check 10 different companies',
    check: s => s.uniqueCompanies >= 10,
  },
]

function computeBadges(stats) {
  return BADGE_DEFS.map(b => ({ ...b, earned: b.check(stats) }))
}

export function useScanHistory() {
  const [history, setHistory] = useState(loadHistory)

  const addScan = useCallback(scan => {
    setHistory(prev => {
      const entry = { id: Date.now().toString(), timestamp: Date.now(), ...scan }
      const next = [entry, ...prev].slice(0, MAX_ENTRIES)
      persist(next)
      return next
    })
  }, [])

  const clearHistory = useCallback(() => {
    setHistory([])
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const stats = useMemo(() => computeStats(history), [history])
  const badges = useMemo(() => computeBadges(stats), [stats])

  return { history, addScan, clearHistory, stats, badges }
}
