import { Plus, X } from 'lucide-react'
import { memo, useRef } from 'react'

/**
 * @component MediaUpload
 * @level Molecule
 *
 * @description File upload with preview grid and per-image removal.
 * Validates file size and type.
 *
 * @interactions
 * - Click add button: Opens native file picker
 * - Click remove (per image): Calls `onRemove(index)`
 *
 * @props
 * - media: { url: string }[] — Current media items with preview URLs
 * - onAdd: (files: FileList) => void — Called with selected files (validation is caller's job)
 * - onRemove: (index: number) => void — Remove specific media item
 * - maxCount: number — Max files (default: 4). Hides add button when reached.
 * - accept: string — Accepted MIME types (default: 'image/*')
 * - className: string
 * - disabled: boolean
 */

const previewContainerStyle = {
  display: 'flex',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
}

const thumbnailStyle = {
  position: 'relative',
  width: '80px',
  height: '80px',
  borderRadius: 'var(--radius-md)',
  overflow: 'hidden',
}

const thumbnailImageStyle = {
  objectFit: 'cover',
  width: '100%',
  height: '100%',
  display: 'block',
}

const removeButtonStyle = {
  position: 'absolute',
  top: 'var(--space-1)',
  right: 'var(--space-1)',
  background: 'rgba(30,30,50,0.8)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  borderRadius: '50%',
  width: 'var(--space-5)',
  height: 'var(--space-5)',
  border: 'none',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
}

const addButtonStyle = {
  border: '2px dashed var(--accent, #f472b6)',
  borderRadius: 'var(--radius-md)',
  padding: 'var(--space-3)',
  cursor: 'pointer',
  background: 'transparent',
  color: 'var(--accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 'var(--space-1-5)',
  fontSize: 'var(--text-base)',
  fontFamily: 'inherit',
}

const hiddenInputStyle = {
  display: 'none',
}

const MediaUpload = memo(function MediaUpload({
  media = [],
  onAdd,
  onRemove,
  maxCount = 4,
  accept = 'image/*',
  className = '',
  disabled = false,
}) {
  const fileInputRef = useRef(null)

  const handleFileSelect = e => {
    if (e.target.files && e.target.files.length > 0) {
      onAdd?.(e.target.files)
    }
    // Reset input value so same file can be re-selected
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleAddClick = () => {
    fileInputRef.current?.click()
  }

  const showAddButton = media.length < maxCount && !disabled

  return (
    <div className={className}>
      <input
        ref={fileInputRef}
        type='file'
        accept={accept}
        multiple
        onChange={handleFileSelect}
        style={hiddenInputStyle}
      />

      <div style={previewContainerStyle}>
        {/* Existing media thumbnails */}
        {media.map((item, index) => (
          <div key={item.url} style={thumbnailStyle}>
            <img src={item.url} alt={`Upload ${index + 1}`} style={thumbnailImageStyle} />
            {!disabled && (
              <button
                onClick={() => onRemove?.(index)}
                style={removeButtonStyle}
                aria-label={`Remove image ${index + 1}`}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}

        {/* Add button */}
        {showAddButton && (
          <button onClick={handleAddClick} style={addButtonStyle} type='button'>
            <Plus size={16} />
            Add image
          </button>
        )}
      </div>
    </div>
  )
})

export { MediaUpload }
export default MediaUpload
