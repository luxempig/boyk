/**
 * @component ImpactDashboard
 * @level Organism
 * @interactions Displays product check stats, streaks, estimated spending impact, top boycotted companies, and earned badges.
 */
import { motion } from 'framer-motion'
import {
  Compass,
  Eye,
  Flame,
  Search,
  Shield,
  ShieldAlert,
  Smartphone,
  Star,
  Target,
  Trophy,
  Zap,
} from 'lucide-react'

const BADGE_ICONS = {
  first_scan: Search,
  scanner_10: Smartphone,
  scanner_50: Eye,
  scanner_100: Shield,
  spotter_5: Target,
  spotter_25: Zap,
  streak_3: Flame,
  streak_7: Star,
  streak_30: Trophy,
  diverse_10: Compass,
}

function StatCard({ label, value, sub, color }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: color || 'var(--text-primary)' }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
      {sub && <div style={styles.statSub}>{sub}</div>}
    </div>
  )
}

function BadgeItem({ badge }) {
  const Icon = BADGE_ICONS[badge.id] || Shield
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      style={{
        ...styles.badge,
        opacity: badge.earned ? 1 : 0.35,
        border: `1px solid ${badge.earned ? 'var(--gold)' : 'var(--border)'}`,
      }}
    >
      <div
        style={{
          ...styles.badgeIcon,
          background: badge.earned
            ? 'linear-gradient(135deg, var(--gold), var(--gold-dark, #d4a017))'
            : 'var(--bg-elevated)',
        }}
      >
        <Icon size={16} color={badge.earned ? '#18181b' : 'var(--text-muted)'} />
      </div>
      <div style={styles.badgeName}>{badge.name}</div>
      <div style={styles.badgeDesc}>{badge.desc}</div>
    </motion.div>
  )
}

export default function ImpactDashboard({ stats, badges }) {
  const earnedCount = badges.filter(b => b.earned).length

  return (
    <div style={{ paddingBottom: 'var(--space-10)' }}>
      {/* Stats grid */}
      <div style={styles.statsGrid}>
        <StatCard
          label='Total Checks'
          value={stats.totalScans}
          sub={`${stats.thisWeek} this week`}
        />
        <StatCard
          label='Boycotted Found'
          value={stats.boycottedFound}
          color='var(--accent)'
          sub={`${stats.boycottedThisWeek} this week`}
        />
        <StatCard
          label='Current Streak'
          value={`${stats.currentStreak}d`}
          color='var(--gold)'
          sub={`Best: ${stats.longestStreak}d`}
        />
        <StatCard label='Companies Checked' value={stats.uniqueCompanies} />
      </div>

      {/* Estimated Impact */}
      {stats.boycottedFound > 0 && (
        <div style={styles.impactCard}>
          <ShieldAlert size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <div>
            <div style={styles.impactTitle}>
              ~${stats.estimatedDiverted} diverted from boycotted companies
            </div>
            <div style={styles.impactSub}>
              Based on {stats.boycottedFound} boycotted product
              {stats.boycottedFound !== 1 ? 's' : ''} you identified and avoided
            </div>
          </div>
        </div>
      )}

      {/* Top boycotted companies */}
      {stats.topBoycotted.length > 0 && (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <h3 style={styles.sectionLabel}>Most Found</h3>
          {stats.topBoycotted.map((c, i) => (
            <div key={c.name} style={styles.topCompany}>
              <span style={styles.topRank}>#{i + 1}</span>
              <span style={styles.topName}>{c.name}</span>
              <span style={styles.topCount}>{c.count}x</span>
            </div>
          ))}
        </div>
      )}

      {/* Badges */}
      <div style={{ marginTop: 'var(--space-6)' }}>
        <h3 style={styles.sectionLabel}>
          Badges ({earnedCount}/{badges.length})
        </h3>
        <div style={styles.badgesGrid}>
          {badges.map(badge => (
            <BadgeItem key={badge.id} badge={badge} />
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = {
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-2-5)',
    marginBottom: 'var(--space-4)',
  },
  statCard: {
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-4) var(--space-3-5)',
    textAlign: 'center',
  },
  statValue: {
    fontSize: 'var(--text-4xl)',
    fontWeight: 'var(--font-bold)',
    lineHeight: 'var(--leading-none)',
    marginBottom: 'var(--space-1)',
  },
  statLabel: {
    fontSize: 'var(--text-xs2)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  statSub: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    marginTop: 'var(--space-1)',
  },
  impactCard: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 'var(--space-3)',
    padding: 'var(--space-4)',
    background: 'var(--accent-subtle)',
    border: '1px solid var(--border-accent)',
    borderRadius: 'var(--radius-lg)',
  },
  impactTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
    marginBottom: 'var(--space-1)',
  },
  impactSub: {
    fontSize: 'var(--text-sm)',
    color: 'var(--text-muted)',
  },
  sectionLabel: {
    fontSize: 'var(--text-xs2)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: 'var(--space-2-5)',
    paddingLeft: 'var(--space-1)',
  },
  topCompany: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2-5)',
    padding: 'var(--space-2-5) var(--space-3-5)',
    background: 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--space-2-5)',
    marginBottom: 'var(--space-1-5)',
  },
  topRank: {
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-bold)',
    color: 'var(--text-muted)',
    width: 24,
  },
  topName: {
    flex: 1,
    fontSize: 'var(--text-base)',
    fontWeight: 'var(--font-medium)',
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  topCount: {
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--accent)',
  },
  badgesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 'var(--space-2-5)',
  },
  badge: {
    background: 'var(--bg-card)',
    borderRadius: 'var(--radius-lg)',
    padding: 'var(--space-3-5) var(--space-3)',
    textAlign: 'center',
  },
  badgeIcon: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto var(--space-2)',
  },
  badgeName: {
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--text-primary)',
    marginBottom: 'var(--space-0-5)',
  },
  badgeDesc: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-muted)',
    lineHeight: 'var(--leading-snug)',
  },
}
