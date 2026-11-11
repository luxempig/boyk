/**
 * @component PlaidLink
 * @level Organism
 * @interactions Fetches Plaid link token, opens Plaid Link flow, and exchanges public token on success.
 */
import { useCallback, useEffect, useState } from 'react'
import { usePlaidLink } from 'react-plaid-link'

import { usePlaid } from '../../hooks/usePlaid'

export default function PlaidLink({ onSuccess, onError }) {
  const [linkToken, setLinkToken] = useState(null)
  const [loading, setLoading] = useState(true)
  const { getLinkToken, exchangeToken } = usePlaid()

  useEffect(() => {
    const fetchLinkToken = async () => {
      try {
        const token = await getLinkToken()
        setLinkToken(token)
      } catch (err) {
        console.error('Error getting link token:', err)
        onError?.(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchLinkToken()
  }, [getLinkToken, onError])

  const handleSuccess = useCallback(
    async (publicToken, metadata) => {
      try {
        await exchangeToken(publicToken, metadata.institution)
        onSuccess?.(metadata.institution)
      } catch (err) {
        console.error('Error exchanging token:', err)
        onError?.(err.message)
      }
    },
    [exchangeToken, onSuccess, onError]
  )

  const config = {
    token: linkToken,
    onSuccess: handleSuccess,
    onExit: err => {
      if (err) {
        console.error('Plaid Link exit with error:', err)
        onError?.(err.display_message || 'Connection cancelled')
      }
    },
  }

  const { open, ready } = usePlaidLink(config)

  if (loading) {
    return (
      <button
        disabled
        style={{
          padding: 'var(--space-4) var(--space-6)',
          background: 'var(--bg-dark)',
          border: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 'var(--text-md)',
          fontWeight: 'var(--font-medium)',
          cursor: 'not-allowed',
        }}
      >
        Loading...
      </button>
    )
  }

  return (
    <button
      onClick={() => open()}
      disabled={!ready}
      style={{
        padding: 'var(--space-4) var(--space-6)',
        background: ready ? 'var(--gradient-accent)' : 'var(--bg-dark)',
        border: 'none',
        color: ready ? 'white' : 'var(--text-muted)',
        fontSize: 'var(--text-md)',
        fontWeight: 'var(--font-medium)',
        textTransform: 'uppercase',
        letterSpacing: '1px',
        cursor: ready ? 'pointer' : 'not-allowed',
      }}
    >
      Connect Bank Account
    </button>
  )
}
