/**
 * Shared connection type colors — single source of truth for all graph visualizations.
 *
 * Values mirror the `--conn-*` design tokens in src/index.css :root. They are
 * duplicated as JS constants because canvas draw loops can't read CSS custom
 * properties per-frame cheaply — if a token changes, update it here too.
 */
export const CONNECTION_COLORS = {
  owned_by: '#3b82f6', // blue — Parents — mirrors --conn-owned-by
  owns: '#22c55e', // green — Subsidiaries — mirrors --conn-owns
  invested_in_by: '#94a3b8', // slate — Investors (no --conn-* token yet; indigo is off-brand)
  invests_in: '#06b6d4', // cyan — Investments (no --conn-* token yet)
  brands: '#a855f7', // purple — Brands — mirrors --conn-brands
  suppliers: '#f59e0b', // amber — Suppliers — mirrors --conn-supplier
  customers: '#06b6d4', // cyan — Customers — mirrors --conn-customers
  people: '#ec4899', // pink — Key People (no --conn-* token yet)
  user_added: '#94a3b8', // slate — User-added, dashed stroke (no --conn-* token yet)
}

export const CONNECTION_LABELS = {
  owned_by: 'Parents',
  owns: 'Subsidiaries',
  invested_in_by: 'Investors',
  invests_in: 'Investments',
  brands: 'Brands',
  suppliers: 'Suppliers',
  customers: 'Customers',
  people: 'People',
  user_added: 'User-added',
}
