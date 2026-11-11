import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'

const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

// Validate a Supabase session JWT via direct /auth/v1/user fetch.
// supabase.auth.getUser() is flaky with the new asymmetric (ES256) keys.
async function verifyUser(jwt: string): Promise<{ id: string } | null> {
  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return null
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${jwt}`, apikey: anonKey },
  })
  if (!res.ok) return null
  const body = await res.json().catch(() => null)
  return body?.id ? { id: body.id } : null
}

interface RequestBody {
  blockedCompany: {
    name: string
    description?: string
  }
  productQuery?: string // What the user was searching for
  boycottInfo?: {
    name: string
    description?: string
    reason?: string
  }
}

serve(async req => {
  const cors = getCorsHeaders(req)

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    // Authenticate user (direct /auth/v1/user fetch — works with ES256 keys).
    const authHeader = req.headers.get('Authorization')
    const jwt = authHeader?.replace(/^Bearer\s+/i, '')
    const user = jwt ? await verifyUser(jwt) : null
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not configured')
    }

    const { blockedCompany, productQuery, boycottInfo }: RequestBody = await req.json()

    if (!blockedCompany?.name) {
      throw new Error('blockedCompany.name is required')
    }

    // Build context for the AI
    let context = `The user is looking for alternatives to products from "${blockedCompany.name}".`

    if (blockedCompany.description) {
      context += ` ${blockedCompany.name} is described as: ${blockedCompany.description}.`
    }

    if (productQuery) {
      context += ` The user was specifically searching for: "${productQuery}".`
    }

    if (boycottInfo) {
      context += `\n\nThe user is boycotting this company as part of "${boycottInfo.name}".`
      if (boycottInfo.description) {
        context += ` Boycott reason: ${boycottInfo.description}`
      }
    }

    const prompt = `${context}

Please suggest 3-5 alternative companies or products that:
1. Offer similar products/services to ${blockedCompany.name}
2. Are NOT owned by or affiliated with ${blockedCompany.name}
3. Are generally considered ethical alternatives

For each alternative, provide:
- Company/brand name
- Brief description (1 sentence)
- Why it's a good alternative

Keep responses concise and practical. Focus on widely available alternatives.

Respond in JSON format:
{
  "alternatives": [
    {
      "name": "Company Name",
      "description": "Brief description",
      "reason": "Why it's a good alternative"
    }
  ],
  "note": "Any important caveat or note about these recommendations"
}`

    // Call Anthropic API using Claude Haiku for fast, cost-effective responses
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Anthropic API error:', error)
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const content = data.content[0]?.text

    if (!content) {
      throw new Error('No response from AI')
    }

    // Parse the JSON response from the AI
    let alternatives
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        alternatives = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', content)
      // Return raw response if JSON parsing fails
      alternatives = {
        alternatives: [],
        note: content,
        parseError: true,
      }
    }

    return new Response(JSON.stringify(alternatives), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
