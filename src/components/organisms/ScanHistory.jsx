/**
 * @component ScanHistory
 * @level Organism
 * @interactions Lists grouped product scan history with date grouping, boycott status indicators, and clear/recheck actions.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Clock, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'

function timeAgo(ts) {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

function groupByDate(history) {
  const today = new Date().toDateString()
  const yesterday = new Date(Date.now() - 86400000).toDateString()
  const weekAgo = Date.now() - 7 * 86400000

  const groups = { Today: [], Yesterday: [], 'This Week': [], Earlier: [] }

  for (const entry of history) {
    const d = new Date(entry.timestamp).toDateString()
    if (d === today) groups.Today.push(entry)
    else if (d === yesterday) groups.Yesterday.push(entry)
    else if (entry.timestamp > weekAgo) groups['This Week'].push(entry)
    else groups.Earlier.push(entry)
  }

  return Object.entries(groups).filter(([, items]) => items.length > 0)
}

export default function ScanHistory({ history, onClear, onRecheck }) {
  if (history.length === 0) {
    return (
      <div style={styles.empty}>
        <Clock size={32} style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-3)' }} />
        <div style={{ fontSize: 'var(--text-md)', color: 'var(--text-muted)' }}>
          No scan history yet
        </div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: 'var(--text-muted)',
            marginTop: 'var(--space-1)',
          }}
        >
          Your product checks will appear here
        </div>
      </div>
    )
  }

  const groups = groupByDate(history)

  return (
    <div style={{ paddingBottom: 'var(--space-10)' }}>
      {/* Clear button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 'var(--space-3)' }}>
        <button onClick={onClear} style={styles.clearButton}>
          <Trash2 size={12} />
          Clear History
        </button>
      </div>

      {groups.map(([label, items]) => (
        <div key={label} style={{ marginBottom: 'var(--space-4)' }}>
          <h3 style={styles.groupLabel}>{label}</h3>
          <AnimatePresence>
            {items.map((entry, idx) => (
              <motion.button
                key={entry.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
                onClick={() => onRecheck?.(entry)}
                style={styles.entry}
              >
                <div
                  style={{
                    ...styles.statusDot,
                    background: entry.hasConflict ? 'var(--danger)' : 'var(--success)',
                  }}
                >
                  {entry.hasConflict ? (
                    <ShieldAlert size={14} color='#fff' />
                  ) : (
                    <ShieldCheck size={14} color='#fff' />
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={styles.entryName}>{entry.companyName}</div>
                  {entry.productName && <div style={styles.entryProduct}>{entry.productName}</div>}
                  {entry.hasConflict && entry.conflicts?.[0] && (
                    <div style={styles.entryConflict}>{entry.conflicts[0].boycottName}</div>
                  )}
                </div>
                <div style={styles.entryMeta}>
                  <span style={styles.entryTime}>{timeAgo(entry.timestamp)}</span>
                  {entry.type === 'barcode' && <span style={styles.entryBadge}>Barcode</span>}
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      ))}
    </div>
  )
}

const styles = {
  empty: {
    textAlign: 'center',
    padding: '60px var(--space-5)',
  },
  clearButton: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1-5)',
    padding: 'var(--space-1-5) var(--space-3)',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    fontSize: 'var(--text-xs2)',
    color: 'var(--text-muted)',
    cursor: 'pointer',
  },
  groupLabel: {
    fontSize: 'var(--text-xs2)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 'var(--space-2)',
    paddingLeft: 'var(--space-1)',
  },
  entry: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-3-5)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    cursor: 'pointer',
    marginBottom: 'var(--space-1-5)',
    transition: 'background 0.15s',
    color: 'inherit',
    textDecoration: 'none',
  },
  statusDot: {
    width: 32,
    height: 32,
    borderRadius: 'var(--radius-full)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  entryName: {
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  entryProduct: {
    fontSize: 'var(--text-xs2)',
    color: 'var(--text-muted)',
    marginTop: 'var(--space-0-5)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  entryConflict: {
    fontSize: 'var(--text-xs2)',
    color: 'var(--accent)',
    marginTop: 'var(--space-0-5)',
    fontWeight: 'var(--font-medium)',
  },
  entryMeta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 'var(--space-1)',
    flexShrink: 0,
  },
  entryTime: {
    fontSize: 'var(--text-xs2)',
    color: 'var(--text-muted)',
    whiteSpace: 'nowrap',
  },
  entryBadge: {
    fontSize: 'var(--text-2xs)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--accent)',
    background: 'var(--accent-subtle)',
    padding: 'var(--space-0-5) var(--space-1-5)',
    borderRadius: 'var(--radius-sm)',
    textTransform: 'uppercase',
  },
}
