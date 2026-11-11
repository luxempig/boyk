import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import LazyImage from '../components/atoms/LazyImage'
import ConfirmModal from '../components/organisms/ConfirmModal'
import Header from '../components/organisms/Header'
import PlaidLink from '../components/organisms/PlaidLink'
import SpendingStats from '../components/organisms/SpendingStats'

const SpendingChart = lazy(() => import('../components/organisms/SpendingChart'))
import { useToast } from '../components/organisms/Toast'
import TransactionList from '../components/organisms/TransactionList'
import { useAuth } from '../context/AuthContext'
import { usePlaid } from '../hooks/usePlaid'
import { useSafeState } from '../hooks/useSafeState'
import { formatCurrency, getDateRange } from '../utils/transactionMatcher'

export default function Spending() {
  const { user } = useAuth()
  const toast = useToast()
  const { safeSetState } = useSafeState()
  const {
    loading: syncing,
    getPlaidItems,
    getSpendingStats,
    getSpendingByCompany,
    getSpendingOverTime,
    getTransactions,
    syncTransactions,
    disconnectItem,
  } = usePlaid()

  const [plaidItems, setPlaidItems] = useState([])
  const [stats, setStats] = useState(null)
  const [companySpending, setCompanySpending] = useState([])
  const [chartData, setChartData] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('overview')
  const [period, setPeriod] = useState('30d')
  const [confirmDisconnect, setConfirmDisconnect] = useState(null)
  const [syncMessage, setSyncMessage] = useState(null)

  const boycottedCompanies = useMemo(
    () => companySpending.filter(c => c.is_boycotted),
    [companySpending]
  )

  // Load all data
  const loadData = useCallback(async () => {
    if (!user) return

    safeSetState(setLoading, true)
    try {
      const { startDate, endDate } = getDateRange(period)

      const [items, statsData, companiesData, chartDataResult, txData] = await Promise.all([
        getPlaidItems(),
        getSpendingStats(startDate, endDate),
        getSpendingByCompany(startDate, endDate),
        getSpendingOverTime(startDate, endDate, period === '90d' ? 'week' : 'day'),
        getTransactions(startDate, endDate, 50, 0),
      ])

      safeSetState(setPlaidItems, items)
      safeSetState(setStats, statsData)
      safeSetState(setCompanySpending, companiesData)
      safeSetState(setChartData, chartDataResult)
      safeSetState(setTransactions, txData)
    } catch {
      toast.error('Failed to load spending data')
    } finally {
      safeSetState(setLoading, false)
    }
  }, [
    user,
    period,
    getPlaidItems,
    getSpendingStats,
    getSpendingByCompany,
    getSpendingOverTime,
    getTransactions,
    safeSetState,
    toast,
  ])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handlePlaidSuccess = useCallback(
    async institution => {
      safeSetState(
        setSyncMessage,
        `Connected to ${institution?.name || 'your bank'}! Syncing transactions...`
      )
      try {
        const result = await syncTransactions()
        toast.success(`Synced ${result?.new_transactions || 0} transactions!`)
        safeSetState(setSyncMessage, null)
        await loadData()
      } catch (err) {
        toast.error(`Error syncing: ${err.message}`)
        safeSetState(setSyncMessage, null)
      }
    },
    [syncTransactions, loadData, safeSetState, toast]
  )

  const handleSync = useCallback(async () => {
    safeSetState(setSyncMessage, 'Syncing transactions...')
    try {
      const result = await syncTransactions()
      toast.success(`Synced ${result?.new_transactions || 0} new transactions!`)
      safeSetState(setSyncMessage, null)
      await loadData()
    } catch (err) {
      toast.error(err.message || 'Sync failed')
      safeSetState(setSyncMessage, null)
    }
  }, [syncTransactions, loadData, safeSetState, toast])

  const handleDisconnect = useCallback(async () => {
    if (!confirmDisconnect) return
    try {
      await disconnectItem(confirmDisconnect)
      toast.success('Account disconnected')
      await loadData()
    } catch {
      toast.error('Failed to disconnect account')
    }
    safeSetState(setConfirmDisconnect, null)
  }, [confirmDisconnect, disconnectItem, loadData, safeSetState, toast])

  if (!user) {
    return (
      <div className='container'>
        <Header pageLabel='Spending Tracker' />
        <div style={{ textAlign: 'center', padding: 'var(--space-12) var(--space-5)' }}>
          <h2 style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-4)' }}>
            Track Your Spending
          </h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--space-6)' }}>
            Connect your bank to see how much you're spending at boycotted companies
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-3)', justifyContent: 'center' }}>
            <Link to='/login' className='btn-primary'>
              Log In
            </Link>
            <Link to='/signup' className='btn-secondary'>
              Sign Up
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const hasConnectedBanks = plaidItems.length > 0

  return (
    <div className='container'>
      <Header pageLabel='Spending Tracker' />

      {/* Status message */}
      {syncMessage && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--accent)',
            padding: 'var(--space-3) var(--space-4)',
            marginBottom: 'var(--space-4)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {syncing && <div className='spinner' style={{ width: '16px', height: '16px' }} />}
          <span>{syncMessage}</span>
        </div>
      )}

      {/* No connected banks - show connection prompt */}
      {!loading && !hasConnectedBanks && (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            padding: 'var(--space-12) var(--space-6)',
            textAlign: 'center',
            marginBottom: 'var(--space-6)',
          }}
        >
          <div
            style={{
              fontSize: '48px',
              marginBottom: 'var(--space-4)',
            }}
          >
            🏦
          </div>
          <h2 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>
            Connect Your Bank
          </h2>
          <p
            style={{
              color: 'var(--text-muted)',
              marginBottom: 'var(--space-6)',
              maxWidth: '400px',
              margin: '0 auto var(--space-6)',
            }}
          >
            Link your bank or credit card to automatically track spending at companies on your
            boycott lists.
          </p>
          <PlaidLink
            onSuccess={handlePlaidSuccess}
            onError={err => setSyncMessage(`Error: ${err}`)}
          />
        </div>
      )}

      {/* Connected banks header */}
      {hasConnectedBanks && (
        <>
          {/* Period selector and sync button */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 'var(--space-4)',
              flexWrap: 'wrap',
              gap: 'var(--space-3)',
            }}
          >
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              {['7d', '30d', '90d', 'all'].map(p => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: 'var(--space-2) var(--space-4)',
                    background: period === p ? 'var(--accent)' : 'transparent',
                    border: period === p ? 'none' : '1px solid var(--border)',
                    color: period === p ? 'white' : 'var(--text-muted)',
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--font-medium)',
                    cursor: 'pointer',
                  }}
                >
                  {p === 'all' ? 'All Time' : p}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  padding: 'var(--space-2) var(--space-4)',
                  background: 'transparent',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontSize: 'var(--text-sm)',
                  cursor: syncing ? 'not-allowed' : 'pointer',
                }}
              >
                {syncing ? 'Syncing...' : 'Sync'}
              </button>
              <PlaidLink
                onSuccess={handlePlaidSuccess}
                onError={err => setSyncMessage(`Error: ${err}`)}
              />
            </div>
          </div>

          {/* Stats */}
          <SpendingStats stats={stats} loading={loading} />

          {/* Chart */}
          <Suspense fallback={<div style={{ height: 200 }} />}>
            <SpendingChart data={chartData} loading={loading} />
          </Suspense>

          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: '0',
              marginBottom: 'var(--space-4)',
              borderBottom: '1px solid var(--border)',
            }}
          >
            {['overview', 'transactions', 'companies', 'accounts'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  padding: 'var(--space-3)',
                  background: 'transparent',
                  border: 'none',
                  borderBottom:
                    activeTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                  color: activeTab === tab ? 'var(--accent)' : 'var(--text-muted)',
                  fontSize: 'var(--text-base)',
                  fontWeight: 'var(--font-medium)',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  cursor: 'pointer',
                }}
              >
                {tab === 'companies' ? 'By Company' : tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ marginBottom: '100px' }}>
            {/* Overview Tab */}
            {activeTab === 'overview' && (
              <div>
                {/* Boycotted companies spending summary */}
                {boycottedCompanies.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-6)' }}>
                    <h3
                      style={{
                        fontSize: 'var(--text-md)',
                        fontWeight: 'var(--font-medium)',
                        marginBottom: 'var(--space-3)',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        color: 'var(--danger)',
                      }}
                    >
                      Boycotted Company Spending
                    </h3>
                    <div
                      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
                    >
                      {boycottedCompanies.slice(0, 5).map(company => (
                        <Link
                          key={company.company_id}
                          to={`/company/${company.company_id}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: 'var(--space-3) var(--space-4)',
                            background: 'rgba(239, 68, 68, 0.1)',
                            border: '1px solid var(--danger)',
                            textDecoration: 'none',
                            color: 'inherit',
                          }}
                        >
                          <div
                            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
                          >
                            {company.company_logo_url ? (
                              <LazyImage
                                src={company.company_logo_url}
                                alt={company.company_name}
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  objectFit: 'contain',
                                  borderRadius: 'var(--radius-sm)',
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  background: 'var(--danger)',
                                  borderRadius: 'var(--radius-sm)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 'var(--text-md)',
                                  fontWeight: 'var(--font-semibold)',
                                  color: 'white',
                                }}
                              >
                                {company.company_name?.charAt(0) || 'C'}
                              </div>
                            )}
                            <div>
                              <div style={{ fontWeight: 'var(--font-medium)' }}>
                                {company.company_name}
                              </div>
                              <div
                                style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}
                              >
                                {company.transaction_count} transactions
                              </div>
                            </div>
                          </div>
                          <div
                            style={{
                              fontWeight: 'var(--font-semibold)',
                              color: 'var(--danger)',
                            }}
                          >
                            {formatCurrency(company.total_spent)}
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recent transactions */}
                <h3
                  style={{
                    fontSize: 'var(--text-md)',
                    fontWeight: 'var(--font-medium)',
                    marginBottom: 'var(--space-3)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    color: 'var(--text-muted)',
                  }}
                >
                  Recent Transactions
                </h3>
                <TransactionList transactions={transactions.slice(0, 10)} loading={loading} />
              </div>
            )}

            {/* Transactions Tab */}
            {activeTab === 'transactions' && (
              <TransactionList transactions={transactions} loading={loading} />
            )}

            {/* Companies Tab */}
            {activeTab === 'companies' && (
              <div>
                {loading ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {[1, 2, 3, 4, 5].map(i => (
                      <div
                        key={i}
                        style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          padding: 'var(--space-4)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <div className='skeleton' style={{ width: '40%', height: '20px' }} />
                        <div className='skeleton' style={{ width: '80px', height: '20px' }} />
                      </div>
                    ))}
                  </div>
                ) : companySpending.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: 'var(--space-8)',
                      color: 'var(--text-muted)',
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    No company matches found
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {companySpending.map(company => (
                      <Link
                        key={company.company_id}
                        to={`/company/${company.company_id}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: 'var(--space-4)',
                          background: company.is_boycotted
                            ? 'rgba(239, 68, 68, 0.1)'
                            : 'var(--bg-card)',
                          border: `1px solid ${company.is_boycotted ? 'var(--danger)' : 'var(--border)'}`,
                          textDecoration: 'none',
                          color: 'inherit',
                        }}
                      >
                        <div
                          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}
                        >
                          {company.company_logo_url ? (
                            <LazyImage
                              src={company.company_logo_url}
                              alt={company.company_name}
                              style={{
                                width: '40px',
                                height: '40px',
                                objectFit: 'contain',
                                borderRadius: 'var(--radius-sm)',
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '40px',
                                height: '40px',
                                background: company.is_boycotted
                                  ? 'var(--danger)'
                                  : 'var(--accent)',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'var(--text-lg)',
                                fontWeight: 'var(--font-semibold)',
                                color: 'white',
                              }}
                            >
                              {company.company_name?.charAt(0) || 'C'}
                            </div>
                          )}
                          <div>
                            <div
                              style={{
                                fontWeight: 'var(--font-medium)',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                              }}
                            >
                              {company.company_name}
                              {company.is_boycotted && (
                                <span
                                  style={{
                                    fontSize: 'var(--text-xs)',
                                    padding: 'var(--space-0-5) var(--space-1-5)',
                                    background: 'var(--danger)',
                                    color: 'white',
                                    textTransform: 'uppercase',
                                    fontWeight: 'var(--font-semibold)',
                                  }}
                                >
                                  Boycotted
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                              {company.transaction_count} transactions
                            </div>
                          </div>
                        </div>
                        <div
                          style={{
                            fontWeight: 'var(--font-semibold)',
                            fontSize: 'var(--text-lg)',
                            color: company.is_boycotted ? 'var(--danger)' : 'var(--text-primary)',
                          }}
                        >
                          {formatCurrency(company.total_spent)}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Accounts Tab */}
            {activeTab === 'accounts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {plaidItems.map(item => (
                  <div
                    key={item.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1px solid var(--border)',
                      padding: 'var(--space-4)',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div
                        style={{ fontWeight: 'var(--font-medium)', marginBottom: 'var(--space-1)' }}
                      >
                        {item.institution_name || 'Connected Account'}
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)' }}>
                        Connected {new Date(item.created_at).toLocaleDateString()}
                        {item.last_synced_at && (
                          <> · Last synced {new Date(item.last_synced_at).toLocaleDateString()}</>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setConfirmDisconnect(item.id)}
                      style={{
                        padding: 'var(--space-2) var(--space-4)',
                        background: 'transparent',
                        border: '1px solid var(--danger)',
                        color: 'var(--danger)',
                        fontSize: 'var(--text-sm)',
                        cursor: 'pointer',
                      }}
                    >
                      Disconnect
                    </button>
                  </div>
                ))}

                <div
                  style={{
                    background: 'var(--bg-dark)',
                    border: '1px dashed var(--border)',
                    padding: 'var(--space-6)',
                    textAlign: 'center',
                  }}
                >
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      marginBottom: 'var(--space-4)',
                      fontSize: 'var(--text-base)',
                    }}
                  >
                    Connect another bank or credit card
                  </p>
                  <PlaidLink
                    onSuccess={handlePlaidSuccess}
                    onError={err => setSyncMessage(`Error: ${err}`)}
                  />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Confirm disconnect modal */}
      <ConfirmModal
        isOpen={!!confirmDisconnect}
        onClose={() => setConfirmDisconnect(null)}
        onConfirm={handleDisconnect}
        title='Disconnect Account'
        message='Are you sure you want to disconnect this account? Your transaction history will be deleted.'
        confirmText='Disconnect'
        danger
      />
    </div>
  )
}
