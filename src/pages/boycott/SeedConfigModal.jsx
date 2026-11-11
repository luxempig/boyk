import { useState } from 'react'

import { Modal } from '../../components/molecules/Modal'
import { useToast } from '../../components/organisms/Toast'
import { useApp } from '../../context/AppContext'

const CONNECTION_TYPES = [
  {
    key: 'block_owns',
    label: 'Subsidiaries',
    description: 'Companies this entity owns',
    dot: '#22c55e',
  },
  {
    key: 'block_owned_by',
    label: 'Parents',
    description: 'Companies that own this entity',
    dot: '#3b82f6',
  },
  {
    key: 'block_brands',
    label: 'Brands',
    description: 'Consumer brands this entity controls',
    dot: '#a855f7',
  },
  {
    key: 'block_suppliers',
    label: 'Suppliers',
    description: 'Companies supplying this entity',
    dot: '#f59e0b',
  },
  {
    key: 'block_customers',
    label: 'Customers',
    description: 'Companies this entity supplies',
    dot: '#06b6d4',
  },
]

/**
 * Per-seed connection settings. Small, focused modal that only touches
 * the five block_* flags for one seed, via the update_boycott_company RPC.
 * Clicking "Configure" on a seed row opens this, not the full edit flow.
 */
export default function SeedConfigModal({ boycottId, seedEntry, onClose }) {
  const toast = useToast()
  const { updateBoycottCompany } = useApp()

  const [flags, setFlags] = useState({
    block_owns: !!seedEntry?.block_owns,
    block_owned_by: !!seedEntry?.block_owned_by,
    block_brands: !!seedEntry?.block_brands,
    block_suppliers: !!seedEntry?.block_suppliers,
    block_customers: !!seedEntry?.block_customers,
  })
  const [saving, setSaving] = useState(false)

  const companyName = seedEntry?.companies?.name || 'this company'
  const companyId = seedEntry?.companies?.id

  const toggle = key => setFlags(prev => ({ ...prev, [key]: !prev[key] }))

  const handleSave = async () => {
    if (!companyId) return
    setSaving(true)
    try {
      await updateBoycottCompany(
        boycottId,
        companyId,
        flags.block_owns,
        flags.block_owned_by,
        flags.block_suppliers,
        flags.block_brands,
        flags.block_customers
      )
      toast.success('Saved')
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} maxWidth={440}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              fontWeight: 'var(--font-bold)',
              color: 'var(--text-primary)',
              margin: 0,
            }}
          >
            Configure {companyName}
          </h2>
          <p
            style={{
              fontSize: 'var(--text-sm)',
              color: 'var(--text-muted)',
              margin: 'var(--space-1) 0 0',
              lineHeight: 1.5,
            }}
          >
            Choose which related entities this seed also blocks. Companies blocked through these
            connections count toward the boycott.
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1-5)',
            padding: 'var(--space-2)',
            background: 'var(--bg-sunken, var(--bg-card-hover))',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          {CONNECTION_TYPES.map(t => {
            const on = flags[t.key]
            const id = `seed-cfg-${t.key}`
            return (
              <label
                key={t.key}
                htmlFor={id}
                aria-label={`${t.label} — ${t.description}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-2-5)',
                  padding: 'var(--space-2) var(--space-2-5)',
                  borderRadius: 'var(--radius-sm)',
                  background: on ? 'var(--bg-card)' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease',
                }}
              >
                <input
                  id={id}
                  type='checkbox'
                  checked={on}
                  onChange={() => toggle(t.key)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: t.dot,
                    flexShrink: 0,
                  }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--text-base)',
                      fontWeight: 'var(--font-semibold)',
                      color: 'var(--text-primary)',
                    }}
                  >
                    {t.label}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--text-xs2)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {t.description}
                  </span>
                </span>
              </label>
            )
          })}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
            marginTop: 'var(--space-2)',
          }}
        >
          <button
            type='button'
            onClick={onClose}
            disabled={saving}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-secondary)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-semibold)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type='button'
            onClick={handleSave}
            disabled={saving}
            style={{
              padding: 'var(--space-2) var(--space-4)',
              background: 'var(--gradient-accent)',
              border: 'none',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-on-accent, #fff)',
              fontSize: 'var(--text-base)',
              fontWeight: 'var(--font-bold)',
              cursor: saving ? 'not-allowed' : 'pointer',
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
