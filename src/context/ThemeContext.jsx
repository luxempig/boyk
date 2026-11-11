import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { useLocalStorage } from '../hooks/useLocalStorage'

const ThemeContext = createContext(null)

function getSystemThemeValue() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

const DENSITY_OPTIONS = ['default', 'compact', 'spacious']
const CORNERS_OPTIONS = ['default', 'sharp', 'pill']

// One-time migration: force all users to the canonical appearance.
// Bump the key when the canonical changes so existing users move with it.
if (!localStorage.getItem('appearance_v4')) {
  localStorage.setItem('theme', JSON.stringify('light'))
  localStorage.setItem('density', JSON.stringify('default'))
  localStorage.setItem('corners', JSON.stringify('pill'))
  localStorage.setItem('designVariant', JSON.stringify('crimson'))
  localStorage.setItem('appearance_v4', '1')
}

// v5: brand refresh — move from "crimson" red to logo-aesthetic purple via the
// `original` design (which uses :root vars). Only nudges designVariant so we
// don't trample users' theme/density/corners preferences.
if (!localStorage.getItem('appearance_v5')) {
  localStorage.setItem('designVariant', JSON.stringify('original'))
  localStorage.setItem('appearance_v5', '1')
}

// v6: the indigo/pink design system is dark-first — the dark tokens ARE the
// brand (near-black glass, gradient wordmark); light is the accessible
// fallback. One-time move to dark; users can still pick light in Settings.
// Also reset corners to 'default': the v4-forced 'pill' inflates every radius
// token past the design spec (--radius-card 20px vs the canonical 14px).
if (!localStorage.getItem('appearance_v6')) {
  localStorage.setItem('theme', JSON.stringify('dark'))
  localStorage.setItem('corners', JSON.stringify('default'))
  localStorage.setItem('appearance_v6', '1')
}

// v7: the "System" theme option was removed from Settings. Collapse any lingering
// 'system' preference to its resolved light/dark value so the toggle has a
// definite state and the picker always reflects a selectable option.
if (!localStorage.getItem('appearance_v7')) {
  try {
    if (JSON.parse(localStorage.getItem('theme')) === 'system') {
      const resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      localStorage.setItem('theme', JSON.stringify(resolved))
    }
  } catch {
    // Malformed/absent value — leave it for useLocalStorage's default to handle.
  }
  localStorage.setItem('appearance_v7', '1')
}

export function ThemeProvider({ children }) {
  // 'system' | 'light' | 'dark'
  const [themePreference, setThemePreference] = useLocalStorage('theme', 'light')
  // 'default' | 'compact' | 'spacious'
  const [density, setDensityState] = useLocalStorage('density', 'default')
  // 'default' | 'sharp' | 'pill'
  const [corners, setCornersState] = useLocalStorage('corners', 'pill')
  // Track system theme separately so changes trigger re-render
  const [systemTheme, setSystemTheme] = useState(getSystemThemeValue)

  const resolvedTheme = themePreference === 'system' ? systemTheme : themePreference
  const isDark = resolvedTheme === 'dark'

  // Apply theme + style variants to document
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-theme', resolvedTheme)

    // Density
    if (density !== 'default') {
      root.setAttribute('data-density', density)
    } else {
      root.removeAttribute('data-density')
    }

    // Corner style
    if (corners !== 'default') {
      root.setAttribute('data-corners', corners)
    } else {
      root.removeAttribute('data-corners')
    }

    // Update meta theme-color for mobile browsers (matches --bg-dark tokens)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]')
    if (metaThemeColor) {
      const themeColors = { dark: '#0b0b10', light: '#faf9f7' }
      metaThemeColor.setAttribute('content', isDark ? themeColors.dark : themeColors.light)
    }
  }, [resolvedTheme, isDark, density, corners])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = () => setSystemTheme(mediaQuery.matches ? 'dark' : 'light')

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  const setTheme = useCallback(
    theme => {
      if (['system', 'light', 'dark'].includes(theme)) {
        setThemePreference(theme)
      }
    },
    [setThemePreference]
  )

  const toggleTheme = useCallback(() => {
    // Toggle between dark and light (the System option was removed).
    setThemePreference(themePreference === 'dark' ? 'light' : 'dark')
  }, [themePreference, setThemePreference])

  const setDensity = useCallback(
    d => {
      if (DENSITY_OPTIONS.includes(d)) setDensityState(d)
    },
    [setDensityState]
  )

  const setCorners = useCallback(
    c => {
      if (CORNERS_OPTIONS.includes(c)) setCornersState(c)
    },
    [setCornersState]
  )

  const value = useMemo(
    () => ({
      theme: themePreference, // The user's preference: 'system' | 'light' | 'dark'
      resolvedTheme, // The actual applied theme: 'light' | 'dark'
      isDark,
      setTheme,
      toggleTheme,
      density,
      setDensity,
      corners,
      setCorners,
    }),
    [
      themePreference,
      resolvedTheme,
      isDark,
      setTheme,
      toggleTheme,
      density,
      setDensity,
      corners,
      setCorners,
    ]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}
