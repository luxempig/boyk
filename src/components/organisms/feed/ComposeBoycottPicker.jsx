import { AnimatePresence, motion } from 'framer-motion'
import { Megaphone, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

/**
 * Slide-up bottom-sheet boycott picker used inside ComposeModal.
 * Three tabs — Mine, Following, Discover (any public boycott).
 */
export default function ComposeBoycottPicker({
  open,
  onClose,
  onSelect,
  myBoycotts = [],
  followedBoycotts = [],
  allBoycotts = [],
}) {
  const [tab, setTab] = useState('mine')
  const [query, setQuery] = useState('')

  const source = tab === 'mine' ? myBoycotts : tab === 'following' ? followedBoycotts : allBoycotts
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return source
    return source.filter(
      b =>
        b.name?.toLowerCase().includes(q) ||
        b.description?.toLowerCase().includes(q) ||
        b.profiles?.username?.toLowerCase().includes(q)
    )
  }, [source, query])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              zIndex: 10,
            }}
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 11,
              background: 'var(--bg-elevated)',
              borderTopLeftRadius: 'var(--radius-xl)',
              borderTopRightRadius: 'var(--radius-xl)',
              boxShadow: 'var(--shadow-lg)',
              maxHeight: '70%',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: 'var(--space-3) var(--space-4)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                style={{
                  fontSize: 'var(--text-md)',
                  fontWeight: 'var(--font-semibold)',
                  color: 'var(--text-primary)',
                }}
              >
                Attach a boycott
              </span>
              <button
                onClick={onClose}
                aria-label='Close boycott picker'
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'var(--text-muted)',
                  padding: 'var(--space-1)',
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
              style={{
                padding: 'var(--space-3) var(--space-4) var(--space-2)',
                display: 'flex',
                gap: 'var(--space-2)',
              }}
            >
              {[
                { key: 'mine', label: 'Mine', count: myBoycotts.length },
                { key: 'following', label: 'Following', count: followedBoycotts.length },
                { key: 'discover', label: 'Discover', count: allBoycotts.length },
              ].map(t => {
                const active = t.key === tab
                return (
                  <button
                    key={t.key}
                    onClick={() => setTab(t.key)}
                    style={{
                      padding: 'var(--space-1-5) var(--space-3)',
                      borderRadius: 'var(--radius-full)',
                      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                      background: active ? 'var(--accent)' : 'transparent',
                      color: active ? '#fff' : 'var(--text-secondary)',
                      fontSize: 'var(--text-sm)',
                      fontWeight: 'var(--font-medium)',
                      cursor: 'pointer',
                    }}
                  >
                    {t.label} {t.count > 0 ? `· ${t.count}` : ''}
                  </button>
                )
              })}
            </div>

            <div style={{ padding: '0 var(--space-4) var(--space-3)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--bg-sunken, var(--bg-card-hover))',
                  borderRadius: 'var(--radius-md)',
                }}
              >
                <Search size={14} style={{ color: 'var(--text-muted)' }} />
                <input
                  type='text'
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={
                    tab === 'mine'
                      ? 'Search my boycotts...'
                      : tab === 'following'
                        ? 'Search followed boycotts...'
                        : 'Search all public boycotts...'
                  }
                  style={{
                    flex: 1,
                    background: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: 'var(--text-primary)',
                    fontSize: 'var(--text-sm)',
                  }}
                />
              </div>
            </div>

            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '0 var(--space-4) var(--space-4)',
              }}
            >
              {filtered.length === 0 ? (
                <div
                  style={{
                    padding: 'var(--space-6) 0',
                    textAlign: 'center',
                    color: 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                  }}
                >
                  {query
                    ? 'No boycotts match that search.'
                    : tab === 'mine'
                      ? "You haven't created any boycotts yet."
                      : tab === 'following'
                        ? "You're not following any boycotts yet."
                        : 'No public boycotts yet.'}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {filtered.map(b => (
                    <button
                      key={b.id}
                      onClick={() => onSelect(b)}
                      style={{
                        display: 'flex',
                        gap: 'var(--space-3)',
                        padding: 'var(--space-3)',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        color: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 'var(--radius-sm)',
                          background: 'var(--accent-subtle, rgba(249,115,22,0.12))',
                          color: 'var(--accent)',
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                        }}
                      >
                        <Megaphone size={16} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 'var(--text-md)',
                            fontWeight: 'var(--font-semibold)',
                            color: 'var(--text-primary)',
                          }}
                        >
                          {b.name}
                        </div>
                        {tab !== 'mine' && b.profiles?.username && (
                          <div style={{ fontSize: 'var(--text-xs2)', color: 'var(--text-muted)' }}>
                            by @{b.profiles.username}
                          </div>
                        )}
                        {b.description && (
                          <div
                            style={{
                              marginTop: 'var(--space-1)',
                              fontSize: 'var(--text-sm)',
                              color: 'var(--text-secondary)',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                            }}
                          >
                            {b.description}
                          </div>
                        )}
                        <div
                          style={{
                            marginTop: 'var(--space-1-5)',
                            fontSize: 'var(--text-xs2)',
                            color: 'var(--text-muted)',
                          }}
                        >
                          {b.boycott_companies?.length ?? b.company_count ?? 0}{' '}
                          {(b.boycott_companies?.length ?? b.company_count ?? 0) === 1
                            ? 'company'
                            : 'companies'}
                          {b.tracker_count
                            ? ` · ${b.tracker_count} ${b.tracker_count === 1 ? 'follower' : 'followers'}`
                            : ''}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
