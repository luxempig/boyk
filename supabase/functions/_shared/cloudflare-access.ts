/**
 * Manage Cloudflare Access email-based allow policy.
 * Adds/removes individual emails from the policy's include list.
 */

const CF_API = 'https://api.cloudflare.com/client/v4'

function getConfig() {
  const accountId = Deno.env.get('CF_ACCOUNT_ID')
  const appId = Deno.env.get('CF_ACCESS_APP_ID')
  const policyId = Deno.env.get('CF_ACCESS_POLICY_ID')
  const apiKey = Deno.env.get('CF_API_KEY')
  const apiEmail = Deno.env.get('CF_API_EMAIL')

  if (!accountId || !appId || !policyId || !apiKey || !apiEmail) {
    throw new Error('Missing Cloudflare Access environment variables')
  }

  return { accountId, appId, policyId, apiKey, apiEmail }
}

function policyUrl(cfg: ReturnType<typeof getConfig>) {
  return `${CF_API}/accounts/${cfg.accountId}/access/apps/${cfg.appId}/policies/${cfg.policyId}`
}

function authHeaders(cfg: ReturnType<typeof getConfig>) {
  return { 'X-Auth-Email': cfg.apiEmail, 'X-Auth-Key': cfg.apiKey }
}

async function getPolicy(cfg: ReturnType<typeof getConfig>) {
  const res = await fetch(policyUrl(cfg), {
    headers: authHeaders(cfg),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`CF Access GET policy failed (${res.status}): ${body}`)
  }
  const json = await res.json()
  return json.result
}

async function updatePolicy(cfg: ReturnType<typeof getConfig>, policy: Record<string, unknown>) {
  const res = await fetch(policyUrl(cfg), {
    method: 'PUT',
    headers: {
      ...authHeaders(cfg),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(policy),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`CF Access PUT policy failed (${res.status}): ${body}`)
  }
  return res.json()
}

export async function addEmailToAccessPolicy(email: string) {
  const cfg = getConfig()
  const policy = await getPolicy(cfg)

  // Build the current email set from include rules
  const emails = new Set<string>()
  for (const rule of policy.include || []) {
    if (rule.email?.email) {
      emails.add(rule.email.email)
    }
  }

  if (emails.has(email)) {
    return // Already in policy
  }

  emails.add(email)

  // Rebuild include as individual email rules (CF Access format)
  policy.include = Array.from(emails).map((e: string) => ({
    email: { email: e },
  }))

  await updatePolicy(cfg, policy)
}

export async function removeEmailFromAccessPolicy(email: string) {
  const cfg = getConfig()
  const policy = await getPolicy(cfg)

  const emails = new Set<string>()
  for (const rule of policy.include || []) {
    if (rule.email?.email) {
      emails.add(rule.email.email)
    }
  }

  if (!emails.has(email)) {
    return // Not in policy
  }

  emails.delete(email)

  policy.include = Array.from(emails).map((e: string) => ({
    email: { email: e },
  }))

  // If no emails left, add a placeholder that won't match anyone
  if (policy.include.length === 0) {
    policy.include = [{ email: { email: 'placeholder@noaccess.invalid' } }]
  }

  await updatePolicy(cfg, policy)
}
