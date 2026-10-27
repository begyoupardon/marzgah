import { describe, expect, it } from 'bun:test'

import { resolveSubscriptionUrl } from './subscription-url'

describe('resolveSubscriptionUrl', () => {
  const base = 'https://sub.example.com'

  it('returns null for empty values', () => {
    expect(resolveSubscriptionUrl(null, { publicBase: base })).toBeNull()
    expect(resolveSubscriptionUrl('', { publicBase: base })).toBeNull()
    expect(resolveSubscriptionUrl('   ', { publicBase: base })).toBeNull()
  })

  it('prefixes relative /sub paths with the public base', () => {
    expect(resolveSubscriptionUrl('/sub/abc123', { publicBase: base })).toBe(
      'https://sub.example.com/sub/abc123',
    )
  })

  it('prefixes relative paths without a leading slash', () => {
    expect(resolveSubscriptionUrl('sub/abc123', { publicBase: base })).toBe(
      'https://sub.example.com/sub/abc123',
    )
  })

  it('keeps already-absolute public URLs', () => {
    expect(
      resolveSubscriptionUrl('https://cdn.example.com/sub/tok', {
        publicBase: base,
      }),
    ).toBe('https://cdn.example.com/sub/tok')
  })

  it('rewrites loopback absolute URLs onto the public origin', () => {
    expect(
      resolveSubscriptionUrl('http://127.0.0.1:8000/sub/tok', {
        publicBase: base,
      }),
    ).toBe('https://sub.example.com/sub/tok')
  })

  it('normalizes protocol-relative URLs', () => {
    expect(
      resolveSubscriptionUrl('//cdn.example.com/sub/tok', { publicBase: base }),
    ).toBe('https://cdn.example.com/sub/tok')
  })

  it('accepts a base without scheme', () => {
    expect(
      resolveSubscriptionUrl('/sub/tok', { publicBase: 'sub.example.com' }),
    ).toBe('https://sub.example.com/sub/tok')
  })
})
