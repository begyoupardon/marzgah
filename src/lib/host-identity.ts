/** Content identity survives catalog reordering; changed endpoints need an explicit selection. */
export async function hostIdentity(host: object): Promise<string> {
  const canonical = JSON.stringify(
    Object.fromEntries(
      Object.entries(host)
        .filter(([key]) => key !== 'is_disabled')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  )
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
