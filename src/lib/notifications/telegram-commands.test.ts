import { expect, it } from 'bun:test'

import { setupRouterTest } from '../../../test/helpers/orpc'
import {
  makeReseller,
  makeUser,
  makeVpnUser,
} from '../../../test/helpers/factories'

const db = await setupRouterTest()
const [{ routeTelegramCommand }, { getResellerTelegramBot, saveTelegramBot }] =
  await Promise.all([import('./telegram-commands'), import('./telegram')])

it('executes read commands through shared procedures and preserves reseller scoping', async () => {
  const owner = await makeReseller(db)
  const other = await makeReseller(db)
  const own = await makeVpnUser(db, owner.id, { marzbanUsername: 'owned_user' })
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
    send: async (text) => {
      output.push(text)
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
