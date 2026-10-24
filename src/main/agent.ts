export function runAgent(args: string[]): number {
  if (args.length === 2 && args[1] === '--help') {
    console.log('Usage: sct agent --stdin\nSubmit local requests through stdin. Use secret references instead of secret values in arguments.\nRequest validation and submission require issue #7. No request can execute yet.')
    return 0
  }
  // Issue #7 adds the authenticated request contract before this entrypoint can accept input.
  console.error(args.length === 2 && args[1] === '--stdin'
    ? 'Local agent requests are unavailable until issue #7 adds request validation and authentication.'
    : 'Usage: sct agent --stdin. Do not put secret values in arguments.')
  return 1
}
