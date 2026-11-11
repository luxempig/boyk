import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, LogOut, Trash2, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import Header from '../components/organisms/Header'
import { useToast } from '../components/organisms/Toast'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { glassCard } from '../lib/glassStyles'
import { supabase } from '../lib/supabase'

const sectionHeadingStyle = {
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--font-semibold)',
  fontFamily: 'Sora, sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '1px',
  color: 'var(--text-muted)',
  marginBottom: 'var(--space-3)',
  paddingLeft: 'var(--space-1)',
}

const glassInputStyle = {
  background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  borderRadius: 'var(--radius-card, 14px)',
}

export default function Settings() {
  const { user, signOut, deleteAccount } = useAuth()
  const { theme, setTheme } = useTheme()
  const navigate = useNavigate()

  const toast = useToast()
  const [profile, setProfile] = useState(null)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState(null)

  // Change password
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordLoading, setPasswordLoading] = useState(false)

  // Edit profile
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [profileLoading, setProfileLoading] = useState(false)

  // Change email
  const [newEmail, setNewEmail] = useState('')
  const [emailLoading, setEmailLoading] = useState(false)
  useEffect(() => {
    if (user) {
      const fetchProfile = async () => {
        try {
          const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', user.id)
            .single()
          if (error) throw error
          if (data) {
            setProfile(data)
            setDisplayName(data.display_name || '')
            setUsername(data.username || '')
          }
        } catch {
          // Profile data is non-critical, page still works without it
        }
      }
      fetchProfile()
    }
  }, [user])

  const handleChangePassword = async e => {
    e.preventDefault()
    if (newPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }
    setPasswordLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })
      if (error) throw error
      setNewPassword('')
      setConfirmPassword('')
      toast.success('Password updated')
    } catch (err) {
      toast.error(err.message || 'Failed to update password')
    } finally {
      setPasswordLoading(false)
    }
  }

  const handleSaveProfile = async e => {
    e.preventDefault()
    if (!username.trim()) {
      toast.error('Username is required')
      return
    }
    setProfileLoading(true)
    try {
      const { error } = await supabase.rpc('update_full_profile', {
        p_username: username.trim(),
        p_display_name: displayName.trim() || null,
        p_bio: profile?.bio || null,
        p_profile_picture_url: profile?.profile_picture_url || null,
      })
      if (error) throw error
      setProfile(prev => ({
        ...prev,
        username: username.trim(),
        display_name: displayName.trim() || null,
      }))
      toast.success('Profile updated')
    } catch (err) {
      toast.error(err.message || 'Failed to update profile')
    } finally {
      setProfileLoading(false)
    }
  }

  const handleChangeEmail = async e => {
    e.preventDefault()
    if (!newEmail.includes('@')) {
      toast.error('Please enter a valid email')
      return
    }
    setEmailLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail })
      if (error) throw error
      setNewEmail('')
      toast.success('Confirmation email sent to your new address')
    } catch (err) {
      toast.error(err.message || 'Failed to update email')
    } finally {
      setEmailLoading(false)
    }
  }

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate('/login')
    } catch (error) {
      console.error('Sign out failed:', error)
    }
  }

  const handleDeleteAccount = async () => {
    if (deleteConfirmText !== 'DELETE') return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteAccount()
      navigate('/login')
    } catch (error) {
      console.error('Delete account failed:', error)
      setDeleteError(error.message || 'Something went wrong. Please try again.')
      setDeleting(false)
    }
  }

  if (!user) {
    return (
      <div className='container'>
        <Header pageLabel='Settings' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-4)' }}>Settings</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-6)' }}>
            Log in to access settings
          </p>
          <Link to='/login' className='btn-primary'>
            Log In
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className='container'>
      <Header pageLabel='Settings' />

      <div style={{ padding: '0 0 160px' }}>
        {/* Account Section */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={sectionHeadingStyle}>Account</h3>
          <div style={{ ...glassCard, padding: 0, overflow: 'hidden' }}>
            {/* Profile Row */}
            <Link
              to={user ? `/user/${user.id}` : '/'}
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--border)',
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              <div
                style={{
                  width: '48px',
                  height: '48px',
                  borderRadius: 'var(--radius-xl)',
                  background: profile?.profile_picture_url
                    ? `url(${profile.profile_picture_url}) center/cover`
                    : 'var(--gradient-accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginRight: 'var(--space-3)',
                  color: 'white',
                  fontWeight: 'var(--font-semibold)',
                  fontSize: 'var(--text-xl)',
                }}
              >
                {!profile?.profile_picture_url &&
                  (profile?.display_name?.charAt(0).toUpperCase() ||
                    profile?.username?.charAt(0).toUpperCase() || <User size={22} />)}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-lg)' }}>
                  {profile?.display_name || profile?.username || 'Your Profile'}
                </div>
                <div style={{ fontSize: 'var(--text-base)', color: 'var(--text-muted)' }}>
                  {profile?.username ? `@${profile.username}` : user.email}
                </div>
              </div>
              <ChevronRight size={20} style={{ color: 'var(--text-muted)' }} />
            </Link>

            {/* Email Row (read-only info) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: 'var(--space-4)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 'var(--text-base)',
                    color: 'var(--text-muted)',
                    marginBottom: 'var(--space-0-5)',
                  }}
                >
                  Email
                </div>
                <div style={{ fontWeight: 'var(--font-medium)' }}>{user.email}</div>
              </div>
            </div>

            {/* Edit display name & username */}
            <form onSubmit={handleSaveProfile} style={{ padding: 'var(--space-4)' }}>
              <div style={{ fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-3)' }}>
                Edit Profile
              </div>
              <input
                type='text'
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder='Display name'
                autoComplete='name'
                className='input-field'
                style={{ ...glassInputStyle, marginBottom: 'var(--space-2)' }}
              />
              <input
                type='text'
                value={username}
                onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                placeholder='Username (letters, numbers, _)'
                autoComplete='username'
                className='input-field'
                style={{ ...glassInputStyle, marginBottom: 'var(--space-3)' }}
              />
              <button
                type='submit'
                disabled={profileLoading || !username.trim()}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: username.trim() ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  color: username.trim() ? '#fff' : 'var(--text-muted)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--font-medium)',
                  cursor: username.trim() ? 'pointer' : 'default',
                  opacity: profileLoading ? 0.7 : 1,
                }}
              >
                {profileLoading ? 'Saving...' : 'Save'}
              </button>
            </form>
          </div>
        </section>

        {/* Appearance Section */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={sectionHeadingStyle}>Appearance</h3>
          <div style={{ ...glassCard, padding: 'var(--space-4)', overflow: 'hidden' }}>
            <div style={{ fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-3)' }}>
              Theme
            </div>
            <div
              role='radiogroup'
              aria-label='Theme'
              style={{
                display: 'flex',
                gap: 'var(--space-1)',
                padding: 'var(--space-1)',
                background: 'var(--glass-input-bg, rgba(20,20,35,0.5))',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {[
                { key: 'light', label: 'Light' },
                { key: 'dark', label: 'Dark' },
              ].map(opt => (
                <button
                  key={opt.key}
                  type='button'
                  role='radio'
                  aria-checked={theme === opt.key}
                  onClick={() => setTheme(opt.key)}
                  style={{
                    flex: 1,
                    padding: 'var(--space-2) var(--space-3)',
                    background: theme === opt.key ? 'var(--accent)' : 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-full)',
                    cursor: 'pointer',
                    fontSize: 'var(--text-sm)',
                    fontWeight: theme === opt.key ? 'var(--font-semibold)' : 'var(--font-medium)',
                    color:
                      theme === opt.key ? 'var(--text-on-accent, #fff)' : 'var(--text-secondary)',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={sectionHeadingStyle}>Security</h3>
          <div style={{ ...glassCard, padding: 0, overflow: 'hidden' }}>
            {/* Change Password */}
            <form
              onSubmit={handleChangePassword}
              style={{ padding: 'var(--space-4)', borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-3)' }}>
                Change Password
              </div>
              <input
                type='password'
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder='New password (8+ chars)'
                autoComplete='new-password'
                className='input-field'
                style={{ ...glassInputStyle, marginBottom: 'var(--space-2)' }}
              />
              <input
                type='password'
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder='Confirm new password'
                autoComplete='new-password'
                className='input-field'
                style={{ ...glassInputStyle, marginBottom: 'var(--space-3)' }}
              />
              <button
                type='submit'
                disabled={passwordLoading || !newPassword}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: newPassword ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  color: newPassword ? '#fff' : 'var(--text-muted)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--font-medium)',
                  cursor: newPassword ? 'pointer' : 'default',
                  opacity: passwordLoading ? 0.7 : 1,
                }}
              >
                {passwordLoading ? 'Updating...' : 'Update Password'}
              </button>
            </form>

            {/* Change Email */}
            <form onSubmit={handleChangeEmail} style={{ padding: 'var(--space-4)' }}>
              <div style={{ fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-2)' }}>
                Change Email
              </div>
              <div
                style={{
                  fontSize: 'var(--text-sm)',
                  color: 'var(--text-muted)',
                  marginBottom: 'var(--space-3)',
                }}
              >
                Current: {user.email}
              </div>
              <input
                type='email'
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder='New email address'
                autoComplete='email'
                className='input-field'
                style={{ ...glassInputStyle, marginBottom: 'var(--space-3)' }}
              />
              <button
                type='submit'
                disabled={emailLoading || !newEmail}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: newEmail ? 'var(--gradient-accent)' : 'var(--bg-elevated)',
                  border: 'none',
                  borderRadius: 'var(--radius-full)',
                  color: newEmail ? '#fff' : 'var(--text-muted)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--font-medium)',
                  cursor: newEmail ? 'pointer' : 'default',
                  opacity: emailLoading ? 0.7 : 1,
                }}
              >
                {emailLoading ? 'Sending...' : 'Update Email'}
              </button>
            </form>
          </div>
        </section>

        {/* Sign Out */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={handleSignOut}
            style={{
              ...glassCard,
              width: '100%',
              padding: 'var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              color: 'var(--accent)',
              fontWeight: 'var(--font-medium)',
              fontSize: 'var(--text-lg)',
            }}
          >
            <LogOut size={18} />
            Sign Out
          </motion.button>
        </section>

        {/* Legal */}
        <section style={{ marginBottom: 'var(--space-6)' }}>
          <h3 style={sectionHeadingStyle}>Legal</h3>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              background: 'var(--bg-card)',
              borderRadius: 'var(--radius-xl)',
              overflow: 'hidden',
            }}
          >
            <Link
              to='/terms'
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: 'var(--text-base)',
              }}
            >
              Terms of Service
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
            </Link>
            <div
              style={{ height: '1px', background: 'var(--border)', margin: '0 var(--space-4)' }}
            />
            <Link
              to='/privacy'
              style={{
                padding: 'var(--space-4)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: 'var(--text-primary)',
                textDecoration: 'none',
                fontSize: 'var(--text-base)',
              }}
            >
              Privacy Policy
              <ChevronRight size={16} style={{ color: 'var(--text-muted)' }} />
            </Link>
          </div>
        </section>

        {/* Delete Account — extra top space marks the danger zone */}
        <section style={{ marginTop: 'var(--space-10)' }}>
          <motion.button
            whileTap={{ scale: 0.98 }}
            onClick={() => setShowDeleteModal(true)}
            style={{
              width: '100%',
              padding: 'var(--space-4)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              background: 'transparent',
              border: '1px solid var(--danger, #ef4444)',
              borderRadius: 'var(--radius-full)',
              cursor: 'pointer',
              color: 'var(--danger, #ef4444)',
              fontWeight: 'var(--font-medium)',
              fontSize: 'var(--text-lg)',
            }}
          >
            <Trash2 size={18} />
            Delete Account
          </motion.button>
        </section>

        {/* App Info */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 'var(--space-8)',
            color: 'var(--text-muted)',
            fontSize: 'var(--text-sm)',
          }}
        >
          <p>Boyk v1.0.0</p>
        </div>
      </div>

      {/* Delete Account Confirmation Modal */}
      <AnimatePresence>
        {showDeleteModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={e => {
              if (e.target === e.currentTarget && !deleting) {
                setShowDeleteModal(false)
                setDeleteConfirmText('')
                setDeleteError(null)
              }
            }}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1000,
              padding: 'var(--space-5)',
            }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'var(--bg-elevated)',
                borderRadius: 'var(--radius-2xl)',
                padding: 'var(--space-6)',
                width: '100%',
                maxWidth: '400px',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
              }}
            >
              <h3
                style={{
                  fontSize: 'var(--text-xl)',
                  fontWeight: 'var(--font-semibold)',
                  marginBottom: 'var(--space-3)',
                  color: 'var(--danger, #ef4444)',
                }}
              >
                Delete Account
              </h3>
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-secondary)',
                  lineHeight: 'var(--leading-normal)',
                }}
              >
                This will permanently delete your account and all your data, including your
                boycotts, posts, follows, and transaction history. This action cannot be undone.
              </p>
              <p
                style={{
                  fontSize: 'var(--text-md)',
                  color: 'var(--text-secondary)',
                  marginTop: 'var(--space-4)',
                  marginBottom: 'var(--space-2)',
                }}
              >
                Type <strong style={{ color: 'var(--text-primary)' }}>DELETE</strong> to confirm:
              </p>
              <input
                type='text'
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                disabled={deleting}
                placeholder='DELETE'
                autoComplete='off'
                style={{
                  ...glassInputStyle,
                  width: '100%',
                  padding: 'var(--space-3)',
                  fontSize: 'var(--text-lg)',
                  border: '1px solid var(--border)',
                  color: 'var(--text-primary)',
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />

              {deleteError && (
                <p
                  style={{
                    fontSize: 'var(--text-base)',
                    color: 'var(--danger, #ef4444)',
                    marginTop: 'var(--space-2)',
                  }}
                >
                  {deleteError}
                </p>
              )}

              <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
                <button
                  onClick={() => {
                    setShowDeleteModal(false)
                    setDeleteConfirmText('')
                    setDeleteError(null)
                  }}
                  disabled={deleting}
                  style={{
                    flex: 1,
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-full)',
                    border: '1px solid var(--border)',
                    background: 'transparent',
                    color: 'var(--text-primary)',
                    fontWeight: 'var(--font-medium)',
                    fontSize: 'var(--text-lg)',
                    cursor: deleting ? 'not-allowed' : 'pointer',
                    opacity: deleting ? 0.5 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteConfirmText !== 'DELETE' || deleting}
                  style={{
                    flex: 1,
                    padding: 'var(--space-3)',
                    borderRadius: 'var(--radius-full)',
                    border: 'none',
                    background:
                      deleteConfirmText === 'DELETE' && !deleting
                        ? 'var(--danger, #ef4444)'
                        : 'var(--bg-elevated)',
                    color:
                      deleteConfirmText === 'DELETE' && !deleting ? 'white' : 'var(--text-muted)',
                    fontWeight: 'var(--font-medium)',
                    fontSize: 'var(--text-lg)',
                    cursor: deleteConfirmText === 'DELETE' && !deleting ? 'pointer' : 'not-allowed',
                  }}
                >
                  {deleting ? 'Deleting...' : 'Delete Account'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
