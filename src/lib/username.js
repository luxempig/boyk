// Username rules — single source of truth shared by the signup form (Auth.jsx)
// and the post-OAuth "choose a username" gate (UsernameGate.jsx) so both paths
// validate identically.

// The handle_new_user DB trigger seeds new signups with
// `'user_' || LEFT(id::text, 8)` when no username is supplied. Google OAuth
// sends no username, so those accounts always land on this exact shape (8 hex
// chars from the UUID). Email signups pick a username up front and never match
// it — which is precisely who we want to prompt for a real handle.
export function isDefaultUsername(username) {
  return /^user_[0-9a-f]{8}$/.test(username || '')
}

// Returns an error string, or null when the username is valid.
export function validateUsername(username) {
  if (username.length < 3) return 'Username must be at least 3 characters'
  if (username.length > 20) return 'Username must be 20 characters or less'
  if (!/^[a-zA-Z0-9_]+$/.test(username))
    return 'Username can only contain letters, numbers, and underscores'
  return null
}
