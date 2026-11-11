import { motion } from 'framer-motion'
import { AtSign } from 'lucide-react'
import { useEffect, useState } from 'react'

import { useAuth } from '../../context/AuthContext'
import { useFocusTrap } from '../../hooks/useFocusTrap'
import { spring } from '../../lib/animations'
import { supabase } from '../../lib/supabase'
import { isDefaultUsername, validateUsername } from '../../lib/username'

/**
 * @component UsernameGate
 * @level Organism
 * @interactions Blocking prompt that forces a user to pick a real username.
 *
 * Google OAuth signups never choose a username — the handle_new_user DB trigger
 * assigns `user_<uuid8>`. This gate detects that default and blocks the app with
 * a non-dismissible "Choose your username" step until the user sets a real one,
 * matching the email-signup flow (which collects a username up front).
 *
 * Mounted once in App.jsx above the routes so it overlays whatever page an OAuth
 * user lands on. Renders nothing for logged-out users or anyone whose username
 * is already custom.
 */
export default function UsernameGate() {
  const { user } = useAuth()
  const [profile, setProfile] = useState(null)
  const [needsUsername, setNeedsUsername] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)
  const focusTrapRef = useFocusTrap(needsUsername)

  // Check the canonical username once per signed-in user. Keyed on user.id so a
  // token refresh (which mints a fresh user object) doesn't re-run it.
  useEffect(() => {
    let cancelled = false
    if (!user?.id) {
      setNeedsUsername(false)
      setProfile(null)
      return
    }
    const check = async () => {
      const { data, error: rpcError } = await supabase.rpc('get_profile', {
        p_user_id: user.id,
      })
      if (cancelled) return
      const row = !rpcError && data?.[0] ? data[0] : null
      // No row (stale/edge session) → don't gate; other surfaces handle that.
      if (row) {
        setProfile(row)
        setNeedsUsername(isDefaultUsername(row.username))
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  const handleSubmit = async e => {
    e.preventDefault()
    const trimmed = value.trim()
    const validationError = validateUsername(trimmed)
    if (validationError) {
      setError(validationError)
      return
    }
    setSaving(true)
    setError(null)
    try {
      // update_full_profile overwrites display_name/bio/picture directly (not
      // COALESCE), so echo the existing values back to avoid wiping them.
      const { error: rpcError } = await supabase.rpc('update_full_profile', {
        p_username: trimmed,
        p_display_name: profile?.display_name ?? null,
        p_bio: profile?.bio ?? null,
        p_profile_picture_url: profile?.profile_picture_url ?? null,
      })
      if (rpcError) throw rpcError
      // Reload so every surface (React Query caches, Home/Feed component state,
      // optimistic-post rendering that reads user_metadata) re-reads the now-set
      // username. This runs exactly once per new account; keeping `saving` true
      // until the reload also blocks a double-submit.
      window.location.reload()
    } catch (err) {
      const isTaken = err?.code === '23505' || /duplicate|unique|already/i.test(err?.message || '')
      setError(isTaken ? 'That username is taken — try another.' : 'Could not save. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (!needsUsername) return null

  const canSubmit = value.trim().length >= 3 && !saving

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-overlay)',
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-5)',
      }}
    >
      <motion.div
        ref={focusTrapRef}
        role='dialog'
        aria-modal='true'
        aria-label='Choose your username'
        initial={{ opacity: 0, y: 30, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={spring}
        style={{
          width: '100%',
          maxWidth: '420px',
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-2xl)',
          border: '1px solid var(--border)',
          padding: 'var(--space-6)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '50%',
            background: 'color-mix(in srgb, var(--accent) 18%, transparent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto var(--space-4)',
          }}
        >
          <AtSign size={24} color='var(--accent)' />
        </div>

        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--text-2xl)',
            fontWeight: 700,
            marginBottom: 'var(--space-2)',
            color: 'var(--text-primary)',
          }}
        >
          Choose your username
        </h2>
        <p
          style={{
            fontSize: 'var(--text-md)',
            lineHeight: 'var(--leading-relaxed)',
            color: 'var(--text-secondary)',
            marginBottom: 'var(--space-5)',
          }}
        >
          This is how others will find and mention you on Boyk. You can change it later in Settings.
        </p>

        <form onSubmit={handleSubmit}>
          <label
            htmlFor='gate-username'
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: '0 var(--space-3)',
              background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
              border: `1px solid ${error ? 'var(--danger, #ef4444)' : 'var(--border)'}`,
              borderRadius: 'var(--radius-card, 14px)',
              marginBottom: 'var(--space-2)',
            }}
          >
            <AtSign size={18} color='var(--text-muted)' aria-hidden='true' />
            <input
              id='gate-username'
              type='text'
              value={value}
              autoComplete='username'
              placeholder='username'
              maxLength={20}
              onChange={e => {
                setValue(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))
                if (error) setError(null)
              }}
              style={{
                flex: 1,
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: 'var(--text-primary)',
                fontSize: 'var(--text-md)',
                padding: 'var(--space-3) 0',
              }}
            />
          </label>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: error ? 'var(--danger, #ef4444)' : 'var(--text-muted)',
              textAlign: 'left',
              minHeight: '1.25em',
              marginBottom: 'var(--space-4)',
            }}
            aria-live='polite'
          >
            {error || 'Letters, numbers, and underscores only.'}
          </p>

          <motion.button
            type='submit'
            disabled={!canSubmit}
            whileTap={canSubmit ? { scale: 0.98 } : undefined}
            style={{
              width: '100%',
              background: canSubmit ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
              border: 'none',
              padding: 'var(--space-4)',
              color: canSubmit ? 'var(--text-on-accent, #fff)' : 'var(--text-muted)',
              fontSize: 'var(--text-md)',
              fontWeight: 'var(--font-semibold)',
              borderRadius: 'var(--radius-full)',
              cursor: canSubmit ? 'pointer' : 'not-allowed',
            }}
          >
            {saving ? 'Saving…' : 'Continue'}
          </motion.button>
        </form>
      </motion.div>
    </div>
  )
}
