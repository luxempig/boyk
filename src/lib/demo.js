// The public site runs as a read-only demo: every page is served from saved
// snapshots (see scripts/demo/), with no database or API behind it. Building
// with VITE_LIVE_BACKEND=true restores the live Supabase + graph API backend.
export const DEMO_MODE = import.meta.env.VITE_LIVE_BACKEND !== 'true'

export const DEMO_SNAPSHOT_DATE = 'November 2026'
export const SOURCE_URL = 'https://github.com/luxempig/boyk'
