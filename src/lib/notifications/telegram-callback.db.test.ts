import { expect, it } from 'bun:test'

import { makeReseller } from '../../../test/helpers/factories'
import { setupRouterTest } from '../../../test/helpers/orpc'

const db = await setupRouterTest()
const { confirmLink, createLinkCode, handleTelegramUpdate, saveTelegramBot } =
  await import('./telegram')

let updateId = 0
async function tap(
  botSecret: string,
  data: string,
  respond: (method: string, body: any) => { ok: boolean; description?: string },
) {
  const calls: Array<{ method: string; body: any }> = []
  const response = await handleTelegramUpdate(
    new Request('https://panel.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': botSecret },
      body: JSON.stringify({
        update_id: ++updateId,
        callback_query: {
          id: 'cb',
          data,
          from: { id: 555 },
          message: { message_id: 42, chat: { id: 555, type: 'private' } },
        },
      }),
    }),
    {
      db,
      notifier: {
        send: async () => ({ ok: true as const }),
        call: async (method: string, body: unknown) => {
          calls.push({ method, body })
          return respond(method, body)
        },
      },
    },
  )
  return { calls, status: response.status }
}

async function linkedBot() {
  const r = await makeReseller(db)
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: r.id,
      botToken: `123456:CB-TOKEN-${++updateId}`,
      botUsername: `cb_bot_${updateId}`,
      enabled: true,
    },
    db,
  )
  const { code } = await createLinkCode(r.id, { db, botId: bot.id })
  await confirmLink(code, '555', { db })
  return bot
}

it('answers a button tap, then edits the tapped message in place', async () => {
  const bot = await linkedBot()
  const { calls } = await tap(bot.webhookSecret, 'm:wallet', () => ({
    ok: true,
  }))
  expect(calls.map((c) => c.method)).toEqual([
    'answerCallbackQuery',
    'editMessageText',
  ])
  expect(calls[1]!.body).toMatchObject({ chat_id: '555', message_id: 42 })
})

it('sends a new message when the edit is refused, and plain text when HTML fails to parse', async () => {
  const bot = await linkedBot()
  const { calls } = await tap(bot.webhookSecret, 'm:wallet', (method, body) => {
    if (method === 'editMessageText')
      return {
        ok: false,
        description: 'Bad Request: message to edit not found',
      }
    if (method === 'sendMessage' && body.parse_mode === 'HTML')
      return { ok: false, description: "Bad Request: can't parse entities" }
    return { ok: true }
  })
  const last = calls.at(-1)!
  expect(last.method).toBe('sendMessage')
  expect(last.body.parse_mode).toBeUndefined()
  expect(last.body.text).not.toContain('<b>')
})

it('still answers with 200 and edits the message when acknowledging the tap fails', async () => {
  const bot = await linkedBot()
  const { calls, status } = await tap(
    bot.webhookSecret,
    'm:wallet',
    (method) => {
      if (method === 'answerCallbackQuery') throw new Error('network down')
      return { ok: true }
    },
  )
  expect(status).toBe(200)
  expect(calls.map((c) => c.method)).toContain('editMessageText')
})

it('re-registers a webhook that Telegram holds without callback_query, and leaves healthy or foreign ones alone', async () => {
  process.env.BETTER_AUTH_URL = 'https://panel.test'
  const { repairBotWebhooks } = await import('./telegram')
  await linkedBot()
  const setCalls: any[] = []
  const api = (hook: Record<string, unknown>) => () => ({
    call: async (method: string, body: unknown) => {
      if (method === 'setWebhook') setCalls.push(body)
      return { ok: true, result: hook }
    },
  })
  const url = 'https://panel.test/api/telegram/webhook'

  expect(
    (await repairBotWebhooks(db, api({ url, allowed_updates: ['message'] })))
      .repaired,
  ).toBeGreaterThan(0)
  expect(setCalls[0]).toMatchObject({
    url,
    allowed_updates: ['message', 'callback_query'],
  })

  setCalls.length = 0
  for (const hook of [
    { url, allowed_updates: ['message', 'callback_query'] },
    { url },
    { url: 'https://elsewhere.test/hook', allowed_updates: ['message'] },
  ])
    expect((await repairBotWebhooks(db, api(hook))).repaired).toBe(0)
  expect(setCalls).toHaveLength(0)
})

it('/diag reports the webhook state and repairs a missing callback_query', async () => {
  process.env.BETTER_AUTH_URL = 'https://panel.test'
  const bot = await linkedBot()
  const { routeTelegramCommand } = await import('./telegram-commands')
  const methods: string[] = []
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    const method = String(url).split('/').pop()!
    methods.push(method)
    return new Response(
      JSON.stringify({
        ok: true,
        result:
          method === 'getWebhookInfo'
            ? {
                url: 'https://panel.test/api/telegram/webhook',
                allowed_updates: ['message'],
                pending_update_count: 3,
                last_error_message: 'Read timeout expired',
              }
            : true,
      }),
    )
  }) as unknown as typeof fetch
  try {
    let out = ''
    await routeTelegramCommand(
      '/diag',
      {
        userId: bot.ownerUserId!,
        botId: bot.id,
        botOwnerId: bot.ownerUserId,
        chatId: '555',
      },
      bot,
      { db, send: async (text) => void (out = text) },
    )
    expect(methods).toEqual(['getWebhookInfo', 'setWebhook'])
    expect(out).toContain('اصلاح شد')
    expect(out).toContain('Read timeout expired')
  } finally {
    globalThis.fetch = realFetch
  }
})
