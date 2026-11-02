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
  await handleTelegramUpdate(
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
  return calls
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
  const calls = await tap(bot.webhookSecret, 'm:wallet', () => ({ ok: true }))
  expect(calls.map((c) => c.method)).toEqual([
    'answerCallbackQuery',
    'editMessageText',
  ])
  expect(calls[1]!.body).toMatchObject({ chat_id: '555', message_id: 42 })
})

it('sends a new message when the edit is refused, and plain text when HTML fails to parse', async () => {
  const bot = await linkedBot()
  const calls = await tap(bot.webhookSecret, 'm:wallet', (method, body) => {
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
