// Shared constants for the user-claims feature.
// Mirrors the CHECK constraints on the underlying tables — the DB is the
// source of truth, but exporting these prevents typos in JS where the
// constraint won't catch a `'user_compny'` until the INSERT round-trips.

// Polymorphic parent kinds for user_evidence.attaches_kind and
// user_claim_votes.target_kind.
export const PARENT_KIND_USER_COMPANY = 'user_company'
export const PARENT_KIND_USER_CONNECTION = 'user_connection'

// Polymorphic ref kinds for user_connections.{source,target}_kind.
export const REF_KIND_NEO4J = 'neo4j'
export const REF_KIND_USER = 'user'

// Vote stances on user_claim_votes.stance.
export const STANCE_AGREE = 'agree'
export const STANCE_DISAGREE = 'disagree'

// Connection types on user_connections.relation. Keep this list in lockstep
// with the CHECK constraint in 20260426000000_user_claims.sql.
export const RELATION_OPTIONS = [
  { value: 'owns', label: 'owns' },
  { value: 'owned_by', label: 'is owned by' },
  { value: 'subsidiary_of', label: 'is a subsidiary of' },
  { value: 'supplies', label: 'supplies' },
  { value: 'customer_of', label: 'is a customer of' },
  { value: 'brand_of', label: 'is a brand of' },
  { value: 'funds', label: 'funds' },
  { value: 'invests_in', label: 'invests in' },
  { value: 'partner_of', label: 'is a partner of' },
  { value: 'member_of', label: 'is a member of' },
  { value: 'other', label: 'other (specify)' },
]
