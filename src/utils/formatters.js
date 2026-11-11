/**
 * Format a date for display
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string (e.g., "Jan 15, 2025")
 */
export function formatDate(date) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format a date with time for display
 * @param {string|Date} date - The date to format
 * @returns {string} Formatted date string (e.g., "Jan 15, 2025, 3:45 PM")
 */
export function formatDateTime(date) {
  if (!date) return ''
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
