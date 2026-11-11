import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { getPlaidClient } from '../_shared/plaid.ts'
import { getSupabaseClient, getSupabaseServiceClient } from '../_shared/supabase.ts'
import * as stringSimilarity from 'npm:string-similarity@4.0.4'

// Clean merchant name for matching
function cleanMerchantName(name: string): string {
  if (!name) return ''
  return name
    .toLowerCase()
    .replace(/[#0-9]+/g, '')
    .replace(/\s+(inc|llc|corp|co|ltd|limited)\.?$/i, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

// Match transaction to company
function matchTransaction(
  merchantName: string | null,
  companies: Array<{ id: string; name: string }>
): { companyId: string; confidence: number } | null {
  if (!merchantName || companies.length === 0) return null

  const cleaned = cleanMerchantName(merchantName)
  if (!cleaned) return null

  let bestMatch: { companyId: string; confidence: number } | null = null

  for (const company of companies) {
    const companyName = company.name.toLowerCase()

    // Exact substring match
    if (cleaned.includes(companyName) || companyName.includes(cleaned)) {
      return { companyId: company.id, confidence: 0.95 }
    }

    // Fuzzy match
    const score = stringSimilarity.compareTwoStrings(cleaned, companyName)
    if (score > 0.6 && (!bestMatch || score > bestMatch.confidence)) {
      bestMatch = { companyId: company.id, confidence: score }
    }
  }

  return bestMatch
}

serve(async req => {
  const cors = getCorsHeaders(req)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Get user from auth header
    const authHeader = req.headers.get('Authorization')
    const supabase = getSupabaseClient(authHeader)

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const serviceClient = getSupabaseServiceClient()
    const plaid = getPlaidClient()

    // Get user's plaid items
    const { data: plaidItems, error: itemsError } = await serviceClient
      .from('plaid_items')
      .select('*')
      .eq('user_id', user.id)

    if (itemsError || !plaidItems?.length) {
      return new Response(JSON.stringify({ error: 'No connected accounts found' }), {
        status: 404,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Get all companies for matching
    const { data: companies } = await serviceClient.from('companies').select('id, name')

    // Get user's boycotted company IDs
    const { data: boycottedCompanies } = await serviceClient
      .rpc('get_user_boycotted_companies', { p_user_id: user.id })
      .catch(() => ({ data: [] }))

    const boycottedIds = new Set(
      (boycottedCompanies || []).map((c: { company_id: string }) => c.company_id)
    )

    let totalSynced = 0
    let totalNew = 0

    for (const plaidItem of plaidItems) {
      try {
        // Sync transactions using cursor for incremental sync
        let hasMore = true
        let cursor = plaidItem.cursor

        while (hasMore) {
          const response = await plaid.transactionsSync({
            access_token: plaidItem.access_token,
            cursor: cursor || undefined,
            count: 100,
          })

          const { added, modified, removed, next_cursor, has_more } = response.data

          // Process added transactions
          const transactionsToInsert = added
            .filter(t => t.amount > 0) // Only include debits
            .map(t => {
              const match = matchTransaction(t.merchant_name || t.name, companies || [])
              return {
                user_id: user.id,
                plaid_item_id: plaidItem.id,
                transaction_id: t.transaction_id,
                amount: Math.abs(t.amount),
                merchant_name: t.merchant_name || t.name,
                date: t.date,
                category: t.category,
                matched_company_id: match?.companyId || null,
                match_confidence: match?.confidence || null,
                is_boycotted: match ? boycottedIds.has(match.companyId) : false,
              }
            })

          if (transactionsToInsert.length > 0) {
            const { error: insertError } = await serviceClient
              .from('plaid_transactions')
              .upsert(transactionsToInsert, {
                onConflict: 'transaction_id',
                ignoreDuplicates: false,
              })

            if (insertError) {
              console.error('Error inserting transactions:', insertError)
            } else {
              totalNew += transactionsToInsert.length
            }
          }

          // Handle modified transactions
          for (const t of modified) {
            const match = matchTransaction(t.merchant_name || t.name, companies || [])
            await serviceClient
              .from('plaid_transactions')
              .update({
                amount: Math.abs(t.amount),
                merchant_name: t.merchant_name || t.name,
                date: t.date,
                category: t.category,
                matched_company_id: match?.companyId || null,
                match_confidence: match?.confidence || null,
                is_boycotted: match ? boycottedIds.has(match.companyId) : false,
              })
              .eq('transaction_id', t.transaction_id)
              .eq('user_id', user.id)
          }

          // Handle removed transactions — scope to the owner (defense in depth;
          // Plaid transaction_ids are globally unique, but never write across users).
          if (removed.length > 0) {
            const removedIds = removed.map(t => t.transaction_id)
            await serviceClient
              .from('plaid_transactions')
              .delete()
              .eq('user_id', user.id)
              .in('transaction_id', removedIds)
          }

          totalSynced += added.length + modified.length
          cursor = next_cursor
          hasMore = has_more
        }

        // Update cursor and last_synced_at
        await serviceClient
          .from('plaid_items')
          .update({
            cursor,
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', plaidItem.id)
      } catch (itemError) {
        console.error(`Error syncing item ${plaidItem.id}:`, itemError)
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        synced: totalSynced,
        new_transactions: totalNew,
      }),
      { headers: { ...cors, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error syncing transactions:', error)
    return new Response(JSON.stringify({ error: error.message || 'Failed to sync transactions' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
