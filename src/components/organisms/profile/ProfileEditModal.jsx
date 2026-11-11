import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { Modal } from '../../molecules/Modal'

/**
 * @component ProfileEditModal
 * @level Organism
 * @interactions Upload profile picture, edit username/display name/bio, save
 *
 * Modal for editing user profile (username, display name, bio, picture).
 */
export default function ProfileEditModal({ isOpen, onClose, profile, onSave, onUploadPicture }) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [pictureUrl, setPictureUrl] = useState('')
  const [uploadingPicture, setUploadingPicture] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef(null)

  // Sync state with profile when modal opens or profile changes
  useEffect(() => {
    if (isOpen && profile) {
      setUsername(profile.username || '')
      setDisplayName(profile.display_name || '')
      setBio(profile.bio || '')
      setPictureUrl(profile.profile_picture_url || '')
    }
  }, [isOpen, profile])

  const handlePictureUpload = async e => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) return
    if (file.size > 5 * 1024 * 1024) return

    setUploadingPicture(true)
    try {
      const url = await onUploadPicture?.(file)
      if (url) {
        setPictureUrl(url)
      }
    } catch (error) {
      console.error('Error uploading profile picture:', error)
    } finally {
      setUploadingPicture(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave?.({
        username: username.trim() || null,
        display_name: displayName.trim() || null,
        bio: bio.trim() || null,
        profile_picture_url: pictureUrl || null,
      })
      onClose?.()
    } catch (error) {
      console.error('Error saving profile:', error)
    } finally {
      setSaving(false)
    }
  }

  const initials = displayName?.charAt(0).toUpperCase() || username?.charAt(0).toUpperCase() || 'U'

  return (
    <Modal isOpen={isOpen} onClose={onClose} title='Edit Profile'>
      <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        {/* Profile Picture */}
        <div style={{ marginBottom: 'var(--space-6)', textAlign: 'center' }}>
          <input
            type='file'
            ref={fileInputRef}
            onChange={handlePictureUpload}
            accept='image/*'
            style={{ display: 'none' }}
          />
          <button
            type='button'
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: '80px',
              height: '80px',
              margin: '0 auto var(--space-3)',
              background: pictureUrl
                ? `url(${pictureUrl}) center/cover`
                : 'linear-gradient(135deg, var(--accent), #ff6b35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 'var(--text-4xl)',
              fontWeight: 'var(--font-bold)',
              color: 'white',
              cursor: 'pointer',
              position: 'relative',
              borderRadius: 'var(--radius-sm)',
              overflow: 'hidden',
              border: 'none',
              padding: 0,
            }}
          >
            {!pictureUrl && initials}
            {uploadingPicture && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.6)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div className='spinner' style={{ width: '24px', height: '24px' }}></div>
              </div>
            )}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPicture}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--accent)',
              fontSize: 'var(--text-base)',
              cursor: 'pointer',
            }}
          >
            {uploadingPicture ? 'Uploading...' : 'Change Photo'}
          </button>
        </div>

        {/* Username */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label className='form-label' htmlFor='edit-username'>
            Username
          </label>
          <input
            id='edit-username'
            type='text'
            className='input-field'
            value={username}
            onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder='username'
            maxLength={50}
          />
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
            }}
          >
            Letters, numbers, and underscores only
          </p>
        </div>

        {/* Display Name */}
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <label className='form-label' htmlFor='edit-display-name'>
            Display Name
          </label>
          <input
            id='edit-display-name'
            type='text'
            className='input-field'
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            placeholder='Your display name (optional)'
          />
        </div>

        {/* Bio */}
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <label className='form-label' htmlFor='edit-bio'>
            Bio
          </label>
          <textarea
            id='edit-bio'
            className='input-field'
            value={bio}
            onChange={e => setBio(e.target.value)}
            placeholder='Tell us about yourself...'
            rows={3}
            maxLength={500}
          />
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              marginTop: 'var(--space-1)',
              textAlign: 'right',
            }}
          >
            {bio.length}/500
          </p>
        </div>

        <motion.button
          onClick={handleSave}
          disabled={saving || uploadingPicture || !username.trim()}
          whileTap={{ scale: 0.98 }}
          style={{
            width: '100%',
            background:
              saving || uploadingPicture || !username.trim()
                ? 'var(--text-muted)'
                : 'var(--accent)',
            border: 'none',
            padding: 'var(--space-4)',
            color: 'white',
            fontSize: 'var(--text-md)',
            fontWeight: 'var(--font-medium)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            cursor: saving || uploadingPicture || !username.trim() ? 'not-allowed' : 'pointer',
          }}
        >
          {saving ? 'Saving...' : 'Save Profile'}
        </motion.button>
      </div>
    </Modal>
  )
}
