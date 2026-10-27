import { describe, expect, it } from 'bun:test'

import { buildInboundsForProxies, needsInboundRepair } from './inbounds'
import type { MarzbanUserResponse } from './types'

describe('buildInboundsForProxies', () => {
  it('maps each proxy protocol to catalog tags', () => {
    expect(
      buildInboundsForProxies(
        { vless: {} },
        {
          vless: [{ tag: 'VLESS-A' }, { tag: 'VLESS-B' }],
          shadowsocks: [{ tag: 'SS' }],
        },
      ),
    ).toEqual({ vless: ['VLESS-A', 'VLESS-B'] })
  })

  it('skips protocols with no catalog entries', () => {
    expect(
      buildInboundsForProxies({ trojan: {} }, { vless: [{ tag: 'A' }] }),
    ).toEqual({})
  })
})

describe('needsInboundRepair', () => {
  const base = {
    username: 'u',
    status: 'active',
    used_traffic: 0,
  } as MarzbanUserResponse

  it('detects empty inbounds with no links', () => {
    expect(
      needsInboundRepair({
        ...base,
        proxies: { vless: { id: 'x' } },
        inbounds: { vless: [] },
        links: [],
      }),
    ).toBe(true)
  })

  it('skips users that already have links', () => {
    expect(
      needsInboundRepair({
        ...base,
        proxies: { vless: { id: 'x' } },
        inbounds: { vless: [] },
        links: ['vless://example'],
      }),
    ).toBe(false)
  })
})
