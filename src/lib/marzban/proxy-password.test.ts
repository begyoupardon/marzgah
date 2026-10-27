import { describe, expect, it } from 'bun:test'

import { applyProxyPassword } from '#/lib/marzban/proxy-password'

describe('applyProxyPassword', () => {
  it('sets password on trojan and shadowsocks', () => {
    const next = applyProxyPassword(
      {
        vless: { id: 'abc' },
        trojan: { password: 'old' },
        shadowsocks: { password: 'old', method: 'chacha20-ietf-poly1305' },
      },
      '1234',
    )
    expect(next).toEqual({
      vless: { id: 'abc' },
      trojan: { password: '1234' },
      shadowsocks: {
        password: '1234',
        method: 'chacha20-ietf-poly1305',
      },
    })
  })

  it('returns null when no password-based proxy exists', () => {
    expect(applyProxyPassword({ vless: { id: 'abc' } }, '1234')).toBeNull()
  })
})
