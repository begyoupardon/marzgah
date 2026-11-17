import { expect, test } from 'bun:test'
import { filterSubscription, hostAllowed } from './subscription-filter'
import { normalizeInbounds, sameBackendInbounds } from './access-policy'
import { hostIdentity } from './host-identity'
import type { AccessCatalog } from './backends/types'
const one = {
  id: '1'.repeat(64),
  address: 'one.example.test',
  remark: 'First host',
  port: 443,
}
const two = {
  id: '2'.repeat(64),
  address: 'two.example.test',
  remark: 'Second host',
  port: 443,
}
const catalog: AccessCatalog = {
  hostsAvailable: true,
  inbounds: [
    { protocol: 'vless', tag: 'shared', port: 443, hosts: [one, two] },
  ],
}
const selected = [{ protocol: 'vless', tag: 'shared', hostIds: [one.id] }]
const links = `vless://id@one.example.test:443#First%20host\nvless://id@two.example.test:443#Second%20host`
test('selects one host without its sibling on the same inbound', () => {
  const result = filterSubscription(
    Buffer.from(links).toString('base64'),
    'v2ray',
    catalog,
    selected,
    'user',
  )
  expect(Buffer.from(result.body, 'base64').toString()).toBe(
    links.split('\n')[0]!,
  )
})
test('filters Clash proxies and their group references', () => {
  const body = JSON.stringify({
    proxies: [
      { name: one.remark, type: 'vless', server: one.address, port: 443 },
      { name: two.remark, type: 'vless', server: two.address, port: 443 },
    ],
    'proxy-groups': [
      { name: 'select', proxies: [one.remark, two.remark, 'DIRECT'] },
    ],
    rules: ['MATCH,select'],
  })
  const result = filterSubscription(body, 'clash', catalog, selected, 'user')
  expect(result.body).toContain(one.address)
  expect(result.body).not.toContain(two.address)
  expect(result.body).not.toContain(two.remark)
  expect(result.body).toContain('DIRECT')
})
test('filters sing-box outbounds and selector references', () => {
  const result = filterSubscription(
    JSON.stringify({
      outbounds: [
        {
          tag: one.remark,
          type: 'vless',
          server: one.address,
          server_port: 443,
        },
        {
          tag: two.remark,
          type: 'vless',
          server: two.address,
          server_port: 443,
        },
        {
          tag: 'select',
          type: 'selector',
          outbounds: [one.remark, two.remark],
          default: two.remark,
        },
      ],
    }),
    'sing-box',
    catalog,
    selected,
    'user',
  )
  const data = JSON.parse(result.body)
  expect(data.outbounds).toHaveLength(2)
  expect(data.outbounds[1].outbounds).toEqual([one.remark])
  expect(data.outbounds[1].default).toBeUndefined()
})
test('filters v2ray JSON configs and rejects opaque formats', () => {
  const config = (host: typeof one) => ({
    remarks: host.remark,
    outbounds: [
      {
        protocol: 'vless',
        settings: { vnext: [{ address: host.address, port: 443 }] },
      },
    ],
  })
  const result = filterSubscription(
    JSON.stringify([config(one), config(two)]),
    'v2ray-json',
    catalog,
    selected,
    'user',
  )
  expect(JSON.parse(result.body)).toEqual([config(one)])
  expect(() =>
    filterSubscription(
      '{"invalid":true}',
      'sing-box',
      catalog,
      selected,
      'user',
    ),
  ).toThrow()
  expect(() =>
    filterSubscription(
      links,
      'v2ray',
      { ...catalog, hostsAvailable: false },
      selected,
      'user',
    ),
  ).toThrow()
})
test('fails closed for ambiguous host definitions', () => {
  const ambiguous: AccessCatalog = {
    hostsAvailable: true,
    inbounds: [
      {
        protocol: 'vless',
        tag: 'shared',
        hosts: [one, { ...one, id: two.id }],
      },
    ],
  }
  expect(() =>
    hostAllowed(
      { protocol: 'vless', address: one.address, port: 443, label: one.remark },
      ambiguous,
      selected,
      'user',
    ),
  ).toThrow('ambiguous')
})
test('host identity survives property ordering and list reordering; endpoint changes require reselection', async () => {
  expect(await hostIdentity({ remark: 'a', address: 'host' })).toBe(
    await hostIdentity({ address: 'host', remark: 'a' }),
  )
  expect(await hostIdentity({ remark: 'a', address: 'new' })).not.toBe(
    await hostIdentity({ remark: 'a', address: 'host' }),
  )
})
test('merges host sets without accidentally selecting the entire inbound', () => {
  expect(
    normalizeInbounds([...selected, { ...selected[0]!, hostIds: [two.id] }])[0]
      ?.hostIds,
  ).toEqual([one.id, two.id])
  expect(
    normalizeInbounds([...selected, { protocol: 'vless', tag: 'shared' }])[0]
      ?.hostIds,
  ).toBeUndefined()
  expect(
    sameBackendInbounds(selected, [{ protocol: 'vless', tag: 'shared' }]),
  ).toBe(true)
})
