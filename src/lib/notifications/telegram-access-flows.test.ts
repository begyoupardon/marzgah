import { expect, test } from 'bun:test'
import { beginFlow, advanceFlow } from './telegram-flows'
import type { FlowCtx } from './telegram-flows'
const inbounds = Array.from({ length: 9 }, (_, index) => ({
  protocol: 'vless',
  tag: `inbound-${index}`,
}))
const ctx: FlowCtx = {
  role: 'reseller',
  locale: 'en',
  invoke: async (command) =>
    command === 'accessUser'
      ? {
          revision: 2,
          policyRevision: 3,
          backend: 'marzban',
          selection: { mode: 'custom', inbounds: [inbounds[0]] },
          required: [inbounds[1]],
          locked: [],
        }
      : {
          inbounds,
          templates: [
            {
              id: 'template',
              name: 'Shared template',
              inbounds: [inbounds[0]],
            },
          ],
        },
}
test('paginated picker keeps choices and finishes with a revision-bound confirmation payload', async () => {
  const first = await beginFlow('access', 'example_user', ctx)
  expect(first?.kind).toBe('ask')
  if (first?.kind !== 'ask') throw new Error('Expected question')
  const next = await advanceFlow(
    'access',
    first.stepIndex,
    first.data,
    'page:1',
    ctx,
  )
  expect(next?.kind).toBe('ask')
  if (next?.kind !== 'ask') throw new Error('Expected second page')
  expect(next.ask.choices?.some((c) => c.label.includes('inbound-8'))).toBe(
    true,
  )
  const toggle = await advanceFlow(
    'access',
    next.stepIndex,
    next.data,
    'toggle:9',
    ctx,
  )
  if (toggle?.kind !== 'ask') throw new Error('Expected selected state')
  const done = await advanceFlow(
    'access',
    toggle.stepIndex,
    toggle.data,
    'done',
    ctx,
  )
  expect(done?.kind).toBe('done')
  if (done?.kind !== 'done' || done.done.kind !== 'action')
    throw new Error('Expected confirmation action')
  expect(done.done.command).toBe('accessAssign')
  expect(done.done.input).toMatchObject({
    username: 'example_user',
    revision: 2,
    policyRevision: 3,
    selection: { mode: 'custom', inbounds: [inbounds[0], inbounds[8]] },
  })
})
test('required inbounds cannot be deselected and template selection stays linked', async () => {
  const first = await beginFlow('access', 'example_user', ctx)
  if (first?.kind !== 'ask') throw new Error('Expected question')
  const fixed = await advanceFlow(
    'access',
    first.stepIndex,
    first.data,
    'toggle:2',
    ctx,
  )
  expect(fixed?.kind).toBe('retry')
  const picked = await advanceFlow(
    'access',
    first.stepIndex,
    first.data,
    'toggle:0',
    ctx,
  )
  if (picked?.kind !== 'ask') throw new Error('Expected template')
  const done = await advanceFlow(
    'access',
    picked.stepIndex,
    picked.data,
    'done',
    ctx,
  )
  if (done?.kind !== 'done') throw new Error('Expected done')
  expect(done.done.input).toMatchObject({
    selection: { mode: 'template', templateId: 'template' },
  })
})
test('admin flows cannot be started by reseller actors', async () => {
  await expect(beginFlow('accessRequired', undefined, ctx)).rejects.toThrow(
    'Administrator',
  )
  await expect(beginFlow('accessTemplate', undefined, ctx)).rejects.toThrow(
    'Administrator',
  )
})
