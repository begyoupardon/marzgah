import type { FlowDef, Data, FlowCtx, Step } from './telegram-flows'
import { esc } from './telegram-ui'
import { inboundKey, normalizeInbounds } from '#/lib/access-policy'
import type { AccessPolicy } from '#/lib/access-policy'
import type { InboundRef } from '#/lib/backends/types'
const text = (c: FlowCtx, fa: string, en: string) =>
  c.locale === 'en' ? en : fa
const refs = (d: Data): InboundRef[] => (d.pick as any)?.inbounds ?? []
const picker: Step = {
  key: 'pick',
  ask: (d, c) => {
    const catalog = d.catalog as any
    const templates = d.kind === 'user' ? catalog.templates : []
    const entries = [
      ...templates.map((t: any) => ({ templateId: t.id, name: t.name })),
      ...catalog.inbounds,
    ]
    d.entries = entries
    const pick = (d.pick as any) ?? {
      page: 0,
      inbounds: d.initial ?? [],
      templateId: null,
    }
    d.pick = pick
    const page = Math.max(
      0,
      Math.min(pick.page ?? 0, Math.max(0, Math.ceil(entries.length / 6) - 1)),
    )
    const fixed = (d.fixed as InboundRef[]) ?? []
    return {
      text: `${text(c, 'دسترسی اتصال؛ موارد را انتخاب کنید و سپس تأیید را بزنید.', 'Connection access: select entries, then choose Done.')}\n${text(c, 'انتخاب‌شده', 'Selected')}: ${esc(
        refs(d)
          .map((i) => i.tag)
          .join(', ')
          .slice(0, 1200),
      )}\n${text(c, 'الزامی / تحت کنترل مدیر', 'Required / admin-controlled')}: ${esc(
        fixed
          .map((i) => i.tag)
          .join(', ')
          .slice(0, 600),
      )}\n${page + 1}/${Math.max(1, Math.ceil(entries.length / 6))}`,
      choices: [
        ...entries
          .slice(page * 6, page * 6 + 6)
          .map((i: any, offset: number) => ({
            label: `${i.templateId ? (pick.templateId === i.templateId ? '✓ ' : '▣ ') : refs(d).some((r) => inboundKey(r) === inboundKey(i)) || fixed.some((r) => inboundKey(r) === inboundKey(i)) ? '✓ ' : '□ '}${String(i.name ?? i.tag).slice(0, 70)}`,
            value: `toggle:${page * 6 + offset}`,
          })),
        ...(page
          ? [{ label: text(c, 'قبلی', 'Previous'), value: `page:${page - 1}` }]
          : []),
        ...((page + 1) * 6 < entries.length
          ? [{ label: text(c, 'بعدی', 'Next'), value: `page:${page + 1}` }]
          : []),
        { label: text(c, 'تأیید انتخاب', 'Done'), value: 'done' },
      ],
    }
  },
  parse: (raw, d) => {
    const prior = d.pick as any
    if (raw.startsWith('page:')) return { ...prior, page: Number(raw.slice(5)) }
    if (raw === 'done') return { ...prior, done: true }
    const entry = (d.entries as any[])[Number(raw.replace('toggle:', ''))]
    if (!entry) throw new Error('Choose an entry')
    if (entry.templateId) {
      const template = (d.catalog as any).templates.find(
        (t: any) => t.id === entry.templateId,
      )
      return {
        ...prior,
        templateId: entry.templateId,
        inbounds: template.inbounds,
      }
    }
    if (
      ((d.fixed as InboundRef[]) ?? []).some(
        (i) => inboundKey(i) === inboundKey(entry),
      )
    )
      throw new Error('This inbound is controlled by the administrator')
    const has = refs(d).some((i) => inboundKey(i) === inboundKey(entry))
    return {
      ...prior,
      templateId: null,
      inbounds: has
        ? refs(d).filter((i) => inboundKey(i) !== inboundKey(entry))
        : normalizeInbounds([...refs(d), entry]),
    }
  },
  repeat: (value) => !(value as any).done,
}
async function adminData(c: FlowCtx) {
  if (c.role !== 'admin') throw new Error('Administrator access required')
  return {
    state: await c.invoke('accessPolicy', {}),
    catalog: await c.invoke('accessCatalog', {}),
  }
}
async function policyDone(d: Data, c: FlowCtx, policy: AccessPolicy) {
  const preview = await c.invoke('accessPreview', { policy })
  return {
    kind: 'action' as const,
    command: 'accessSavePolicy',
    input: {
      backend: 'marzban',
      policy,
      revision: (d.state as any).revision,
      idempotencyKey: crypto.randomUUID(),
    },
    summary: `${text(c, 'اعمال سیاست دسترسی؛ تعداد کاربران تحت تأثیر', 'Apply connection access policy; affected users')}: ${preview.affected}`,
  }
}
export const ACCESS_FLOWS: Record<string, FlowDef> = {
  access: {
    start: (arg) => ({ username: arg, kind: 'user' }),
    steps: [
      {
        key: 'username',
        skip: (d) => Boolean(d.username),
        ask: (_d, c) => ({
          text: text(c, 'نام کاربری VPN را بفرستید.', 'Send the VPN username.'),
        }),
        parse: (raw) => raw.trim(),
      },
      {
        ...picker,
        ask: async (d, c) => {
          if (!d.view) {
            d.view = await c.invoke('accessUser', { username: d.username })
            const view = d.view as any
            d.catalog = await c.invoke('accessCatalog', {
              backend: view.backend,
            })
            d.initial =
              view.selection.mode === 'custom'
                ? (view.base ?? view.selection.inbounds)
                : ((d.catalog as any).templates.find(
                    (t: any) => t.id === view.selection.templateId,
                  )?.inbounds ?? view.effective)
            d.fixed = [...view.required, ...view.locked]
            d.pick = {
              inbounds: d.initial,
              templateId:
                view.selection.mode === 'template'
                  ? view.selection.templateId
                  : null,
              page: 0,
            }
          }
          return picker.ask(d, c)
        },
      },
    ],
    finish: (d, c) => {
      const view = d.view as any
      const pick = d.pick as any
      return {
        kind: 'action',
        command: 'accessAssign',
        input: {
          username: d.username,
          revision: view.revision,
          policyRevision: view.policyRevision,
          selection: pick.templateId
            ? { mode: 'template', templateId: pick.templateId }
            : { mode: 'custom', inbounds: refs(d) },
          idempotencyKey: crypto.randomUUID(),
        },
        summary: `${text(c, 'تغییر دسترسی', 'Change access for')} ${d.username}: ${refs(
          d,
        )
          .map((i) => i.tag)
          .join(', ')}`,
      }
    },
  },
  accessRequired: {
    start: async (_arg, c) => {
      const data = await adminData(c)
      return { ...data, initial: data.state.policy.required }
    },
    steps: [picker],
    finish: (d, c) =>
      policyDone(d, c, { ...(d.state as any).policy, required: refs(d) }),
  },
  accessTemplate: {
    start: async (arg, c) => {
      const data = await adminData(c)
      const template = data.state.policy.templates.find(
        (t: any) => t.id === arg,
      )
      if (arg && !template) throw new Error('Template not found')
      return {
        ...data,
        templateId: template?.id ?? crypto.randomUUID(),
        initial: template?.inbounds ?? [],
      }
    },
    steps: [
      {
        key: 'name',
        ask: (_d, c) => ({
          text: text(c, 'نام قالب را بفرستید.', 'Send the template name.'),
        }),
        parse: (raw) => {
          if (!raw.trim() || raw.length > 100)
            throw new Error('Use 1–100 characters')
          return raw.trim()
        },
      },
      picker,
    ],
    finish: (d, c) => {
      const policy = (d.state as any).policy as AccessPolicy
      return policyDone(d, c, {
        ...policy,
        templates: [
          ...policy.templates.filter((t) => t.id !== d.templateId),
          { id: String(d.templateId), name: String(d.name), inbounds: refs(d) },
        ],
      })
    },
  },
  accessReseller: {
    start: async (arg, c) => ({ ...(await adminData(c)), resellerId: arg }),
    steps: [
      {
        key: 'resellerId',
        skip: (d) => Boolean(d.resellerId),
        ask: async (_d, c) => ({
          text: text(c, 'شناسه نماینده را بفرستید.', 'Send the reseller ID.'),
        }),
        parse: (raw) => raw.trim(),
      },
      {
        ...picker,
        ask: (d, c) => {
          d.initial ??=
            (d.state as any).policy.resellers.find(
              (r: any) => r.resellerId === d.resellerId,
            )?.allowed ?? (d.state as any).policy.approved
          return picker.ask(d, c)
        },
      },
      {
        key: 'defaultTemplateId',
        ask: (d, c) => ({
          text: `${text(c, 'شناسه قالب پیش‌فرض را بفرستید؛ - برای پیش‌فرض VLESS.', 'Send a default template ID; - for the VLESS default.')}\n${(
            d.state as any
          ).policy.templates
            .map((t: any) => `${esc(t.id)}: ${esc(t.name)}`)
            .join('\n')
            .slice(0, 3000)}`,
          choices: [
            { label: text(c, 'پیش‌فرض VLESS', 'VLESS default'), value: '-' },
          ],
        }),
        parse: (raw) => (raw === '-' ? null : raw.trim()),
      },
    ],
    finish: (d, c) => {
      const policy = (d.state as any).policy as AccessPolicy
      return policyDone(d, c, {
        ...policy,
        resellers: [
          ...policy.resellers.filter((r) => r.resellerId !== d.resellerId),
          {
            resellerId: String(d.resellerId),
            allowed: refs(d),
            defaultTemplateId: d.defaultTemplateId as string | null,
          },
        ],
      })
    },
  },
}
