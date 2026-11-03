import { afterAll, expect, it } from 'bun:test'

import { setupRouterTest } from '../../../test/helpers/orpc'
import { FakeBackend } from '../../../test/fakes/backend'
import { resetBackends, setBackend } from '#/lib/backends/registry'
import { telegramConfirmations } from '#/db/schema'
import { gbToBytes } from '#/lib/vpn-plans'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'

const db = await setupRouterTest()
afterAll(() => resetBackends())
const [
  { routeTelegramCommand, handleTelegramCallback },
  { getResellerTelegramBot, saveTelegramBot },
] = await Promise.all([import('./telegram-commands'), import('./telegram')])

it('executes read commands through shared procedures and preserves reseller scoping', async () => {
  const owner = await makeReseller(db)
  const other = await makeReseller(db)
  const own = await makeVpnUser(db, owner.id, {
    marzbanUsername: 'owned_user',
  })
  await makeVpnUser(db, other.id, { marzbanUsername: 'private_user' })
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: owner.id,
      botToken: '123456:COMMAND-TEST',
      botUsername: 'owner_bot',
    },
    db,
  )
  const output: string[] = []
  const actor = {
    userId: owner.id,
    botId: bot.id,
    botOwnerId: owner.id,
    chatId: '8123',
  }
  await routeTelegramCommand('/users', actor, bot, {
    db,
    send: async (text, keyboard) => {
      output.push(text, ...(keyboard ?? []).flat().map((b) => b.text))
    },
  })
  expect(output.join('\n')).toContain(own.marzbanUsername)
  expect(output.join('\n')).not.toContain('private_user')
  await expect(
    routeTelegramCommand('/resellers', actor, bot, {
      db,
      send: async () => {},
    }),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' })

  const admin = await makeUser(db, 'admin')
  const platformBot = await saveTelegramBot(
    {
      kind: 'platform',
      ownerUserId: null,
      botToken: '123456:ADMIN-COMMAND',
      botUsername: 'platform_bot',
    },
    db,
  )
  const adminOutput: string[] = []
  await routeTelegramCommand(
    '/resellers',
    {
      userId: admin.id,
      botId: platformBot.id,
      botOwnerId: null,
      chatId: '8124',
    },
    platformBot,
    {
      db,
      send: async (text) => {
        adminOutput.push(text)
      },
    },
  )
  expect(adminOutput).toHaveLength(1)

  const migratedBot = await getResellerTelegramBot(owner.id, db)
  expect(migratedBot?.id).toBe(bot.id)
})

it('walks card → action → confirm through buttons, and guards admin-only actions', async () => {
  const owner = await makeReseller(db)
  const fake = new FakeBackend()
  fake.seed({ username: 'btn_user' })
  setBackend('marzban', fake)
  await makeVpnUser(db, owner.id, { marzbanUsername: 'btn_user' })
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: owner.id,
      botToken: '123456:BUTTON-TEST',
      botUsername: 'btn_bot',
    },
    db,
  )
  const actor = {
    userId: owner.id,
    botId: bot.id,
    botOwnerId: owner.id,
    chatId: '9001',
  }
  let last: { text: string; keyboard?: { text: string; data: string }[][] } = {
    text: '',
  }
  const send = async (text: string, keyboard?: any) => {
    last = { text, keyboard }
  }

  await handleTelegramCallback('u:btn_user', actor, { db, send })
  expect(last.text).toContain('btn_user')
  const flat = last.keyboard!.flat()
  expect(flat.some((b) => b.data === 'a:ar:btn_user')).toBe(false)
  for (const b of flat)
    expect(Buffer.byteLength(b.data)).toBeLessThanOrEqual(64)

  // admin-only action is refused for a reseller even if the data is forged
  await handleTelegramCallback('a:ar:btn_user', actor, { db, send })
  expect(last.text).toContain('نامعتبر')

  await handleTelegramCallback('a:ds:btn_user', actor, { db, send })
  const confirm = last
    .keyboard!.flat()
    .find((b) => b.data.startsWith('confirm:'))
  expect(confirm).toBeDefined()
  await handleTelegramCallback(confirm!.data, actor, { db, send })
  expect(last.text).toContain('انجام شد')
  // single use
  await handleTelegramCallback(confirm!.data, actor, { db, send })
  expect(last.text).toContain('منقضی')
})

it('accepts 0.1 GB in direct Telegram create and renew commands', async () => {
  const owner = await makeReseller(db)
  const bot = await saveTelegramBot(
    {
      kind: 'reseller',
      ownerUserId: owner.id,
      botToken: '123456:DECIMAL-COMMAND',
      botUsername: 'decimal_bot',
    },
    db,
  )
  const actor = {
    userId: owner.id,
    botId: bot.id,
    botOwnerId: owner.id,
    chatId: '8130',
  }
  const send = async () => {}
  await routeTelegramCommand('/create small 0.1 30', actor, bot, { db, send })
  await routeTelegramCommand('/renew small 30 0.1', actor, bot, { db, send })
  const rows = await db.select().from(telegramConfirmations)
  const own = rows.filter((row) => row.actorUserId === owner.id)
  expect(own).toHaveLength(2)
  expect(JSON.parse(own[0].payloadJson).input.dataLimitBytes).toBe(
    gbToBytes(0.1),
  )
  expect(JSON.parse(own[1].payloadJson).input.additionalDataLimitBytes).toBe(
    gbToBytes(0.1),
  )
})
