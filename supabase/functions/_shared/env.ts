// Tiny helper for reading required environment variables.
//
// Why: many edge functions had `Deno.env.get('FOO')!` peppered through them.
// The non-null assertion is a TypeScript lie — at runtime a missing env var
// becomes `undefined`, which then silently flows into supabase clients,
// fetch URLs, and signing keys. The downstream errors are confusing.
//
// `requireEnv` throws at first call so the failure is loud and immediate.
// In edge-function deployment, this surfaces in the function logs as a
// clear "Missing required environment variable: X" and returns a gateway
// error to the caller — far better than running with undefined.

export function requireEnv(name: string): string {
  const value = Deno.env.get(name)
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}
