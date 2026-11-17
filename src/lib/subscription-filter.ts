import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type {
  AccessCatalog,
  InboundRef,
  SubscriptionFormat,
} from '#/lib/backends/types'
import { inboundKey } from './access-policy'

type Node = { protocol: string; address: string; port?: number; label?: string }
const protocols = new Set(['vless', 'vmess', 'trojan', 'shadowsocks', 'ss'])
function pattern(value: string, username: string): RegExp {
  const escaped = value
    .replaceAll('{USERNAME}', username)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `^${escaped.replace(/\\\*/g, '[a-f0-9]+').replace(/\\\{[^}]+\\\}/g, '.+?')}(?: \\(\\d+\\))?$`,
    'i',
  )
}
function normalizeAddress(value: string) {
  return value.replace(/^\[|\]$/g, '').toLowerCase()
}
/** Ambiguous hosts fail closed; endpoint/remark changes never silently broaden a subscription. */
export function hostAllowed(
  node: Node,
  catalog: AccessCatalog,
  selected: InboundRef[],
  username: string,
): boolean {
  const candidates = catalog.inbounds.flatMap((inbound) =>
    inbound.protocol === node.protocol
      ? inbound.hosts
          .filter(
            (host) =>
              !host.disabled &&
              host.address
                .split(',')
                .some((address) =>
                  pattern(normalizeAddress(address.trim()), username).test(
                    normalizeAddress(node.address),
                  ),
                ) &&
              ((!host.port && !inbound.port) ||
                Number(host.port ?? inbound.port) === node.port) &&
              (!node.label || pattern(host.remark, username).test(node.label)),
          )
          .map((host) => ({ inbound, host }))
      : [],
  )
  if (!candidates.length) return false
  const allowed = candidates.map(({ inbound, host }) => {
    const rule = selected.find((i) => inboundKey(i) === inboundKey(inbound))
    return Boolean(
      rule && (!rule.hostIds || (host.id && rule.hostIds.includes(host.id))),
    )
  })
  if (allowed.some(Boolean) && !allowed.every(Boolean))
    throw new Error(
      'Host definitions are ambiguous. Give each host a unique remark or endpoint.',
    )
  return allowed.every(Boolean)
}
function decode64(value: string): string {
  return Buffer.from(value, 'base64').toString('utf8')
}
function linkNode(link: string): Node {
  if (link.startsWith('vmess://')) {
    const node = JSON.parse(decode64(link.slice(8)))
    return {
      protocol: 'vmess',
      address: String(node.add),
      port: Number(node.port),
      label: node.ps,
    }
  }
  let url = new URL(link)
  if (link.startsWith('ss://') && !link.split('#')[0]!.includes('@')) {
    const hash = url.hash
    url = new URL('ss://' + decode64(link.slice(5).split('#')[0]!))
    url.hash = hash
  }
  return {
    protocol:
      url.protocol === 'ss:' ? 'shadowsocks' : url.protocol.slice(0, -1),
    address: url.hostname,
    port: Number(url.port) || undefined,
    label: url.hash ? decodeURIComponent(url.hash.slice(1)) : undefined,
  }
}
export function filterSubscription(
  body: string,
  format: SubscriptionFormat,
  catalog: AccessCatalog,
  selected: InboundRef[],
  username: string,
): { body: string; contentType: string } {
  const permits = (node: Node) => hostAllowed(node, catalog, selected, username)
  if (!catalog.hostsAvailable) throw new Error('Host catalog is unavailable')
  if (format === 'v2ray') {
    const decoded = body.trim().includes('://')
      ? body.trim()
      : decode64(body.trim())
    const links = decoded
      .split(/\r?\n/)
      .filter(Boolean)
      .filter((link) => permits(linkNode(link)))
    if (!links.length) throw new Error('Selected host configs are not ready')
    return {
      body: Buffer.from(links.join('\n')).toString('base64'),
      contentType: 'text/plain; charset=utf-8',
    }
  }
  if (format === 'clash' || format === 'clash-meta') {
    const data = parseYaml(body, { maxAliasCount: 20 })
    if (
      !Array.isArray(data?.proxies) ||
      (data['proxy-providers'] && Object.keys(data['proxy-providers']).length)
    )
      throw new Error('Unsupported subscription structure')
    const removed = new Set<string>()
    data.proxies = data.proxies.filter((proxy: any) => {
      const keep = permits({
        protocol: proxy.type === 'ss' ? 'shadowsocks' : proxy.type,
        address: proxy.server,
        port: Number(proxy.port),
        label: proxy.name,
      })
      if (!keep) removed.add(proxy.name)
      return keep
    })
    if (!data.proxies.length)
      throw new Error('Selected host configs are not ready')
    for (const group of data['proxy-groups'] ?? []) {
      if (group.use?.length || group['include-all-providers'])
        throw new Error('Unsupported subscription structure')
      if (Array.isArray(group.proxies))
        group.proxies = group.proxies.filter(
          (name: string) => !removed.has(name),
        )
    }
    return {
      body: stringifyYaml(data),
      contentType: 'text/yaml; charset=utf-8',
    }
  }
  const data = JSON.parse(body)
  if (format === 'sing-box') {
    if (data.endpoints?.length)
      throw new Error('Unsupported subscription structure')
    if (!Array.isArray(data?.outbounds))
      throw new Error('Unsupported subscription structure')
    const removed = new Set<string>()
    data.outbounds = data.outbounds.filter((outbound: any) => {
      if (!protocols.has(outbound.type)) {
        if (outbound.server)
          throw new Error('Unsupported subscription outbound')
        return true
      }
      const keep = permits({
        protocol: outbound.type,
        address: outbound.server,
        port: Number(outbound.server_port),
        label: outbound.tag,
      })
      if (!keep) removed.add(outbound.tag)
      return keep
    })
    if (!data.outbounds.some((outbound: any) => protocols.has(outbound.type)))
      throw new Error('Selected host configs are not ready')
    for (const outbound of data.outbounds) {
      if (Array.isArray(outbound.outbounds))
        outbound.outbounds = outbound.outbounds.filter(
          (name: string) => !removed.has(name),
        )
      if (removed.has(outbound.default)) delete outbound.default
    }
    if (removed.has(data.route?.final))
      data.route.final = data.outbounds.find((o: any) =>
        protocols.has(o.type),
      ).tag
    return { body: JSON.stringify(data), contentType: 'application/json' }
  }
  if (format === 'v2ray-json') {
    if (!Array.isArray(data))
      throw new Error('Unsupported subscription structure')
    const filtered = data.filter((config: any) => {
      if (!Array.isArray(config.outbounds))
        throw new Error('Unsupported subscription structure')
      const proxies = config.outbounds.filter((o: any) =>
        protocols.has(o.protocol),
      )
      if (!proxies.length) return false
      return proxies.every((o: any) => {
        const servers = o.settings?.vnext ?? o.settings?.servers
        if (!Array.isArray(servers) || servers.length !== 1)
          throw new Error('Unsupported subscription structure')
        const server = servers[0]
        return (
          server &&
          permits({
            protocol: o.protocol,
            address: server.address,
            port: Number(server.port),
            label: config.remarks,
          })
        )
      })
    })
    if (!filtered.length) throw new Error('Selected host configs are not ready')
    return { body: JSON.stringify(filtered), contentType: 'application/json' }
  }
  if (!Array.isArray(data))
    throw new Error('Unsupported subscription structure')
  const filtered = data.filter((item: any) =>
    typeof item === 'string'
      ? permits(linkNode(item))
      : permits({
          protocol: 'shadowsocks',
          address: item.server,
          port: Number(item.server_port ?? item.port),
          label: item.name,
        }),
  )
  if (!filtered.length) throw new Error('Selected host configs are not ready')
  return { body: JSON.stringify(filtered), contentType: 'application/json' }
}
