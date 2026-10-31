import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const email = 'reseller.e2e@example.test'
const password = 'E2E-only-password-12345'

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('ایمیل').fill(email)
  await page.getByLabel('رمز عبور').fill(password)
  await page.getByRole('button', { name: 'ورود' }).click()
  await expect(page).toHaveURL(/dashboard/)
}

test('reseller navigates across sections, history, reload, and mobile layout', async ({
  page,
}) => {
  await signIn(page)
  const paths = ['/users', '/notifications', '/analytics', '/sales', '/wallet']
  for (const path of paths) {
    const link = page.locator(`nav a[href$="${path}"]`).first()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(
      page.locator('main, [data-slot="sidebar-inset"]'),
    ).toBeVisible()
  }

  await page.goBack()
  await expect(page).toHaveURL(/sales$/)
  await page.goBack()
  await expect(page).toHaveURL(/analytics$/)
  await page.goForward()
  await expect(page).toHaveURL(/sales$/)
  await page.reload()
  await expect(page).toHaveURL(/sales$/)

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'باز و بسته کردن منو' }).click()
  await expect(page.locator('nav a[href$="/users"]')).toBeVisible()
  await page.locator('nav a[href$="/users"]').click()
  await expect(page).toHaveURL(/users$/)
  const mobileWidth = await page
    .locator('body')
    .evaluate((el) => el.scrollWidth)
  expect(mobileWidth).toBeLessThanOrEqual(390)
})

test('renewal replaces remaining time, adds quota, and preserves traffic', async ({
  page,
  request,
}) => {
  await signIn(page)
  await page.locator('nav a[href$="/users"]').click()
  await expect(
    page.getByRole('table').getByText('e2e_qa_customer'),
  ).toBeVisible()
  await page
    .getByRole('table')
    .getByRole('button', { name: 'تمدید / ویرایش' })
    .click()
  await expect(page.getByText(/زمان باقی‌مانده حذف خواهد شد/)).toBeVisible()
  await expect(page.getByText(/مصرف فعلی حفظ می‌شود/)).toBeVisible()
  await page.getByRole('button', { name: 'تأیید تمدید' }).click()
  await expect(page.getByText('کاربر تمدید شد')).toBeVisible()

  const marzbanPort = Number(readFileSync('.playwright-e2e-port', 'utf8'))
  const state = await request.get(
    `http://127.0.0.1:${marzbanPort}/__e2e/state`,
    {
      headers: { 'x-e2e-secret': 'local-e2e-only' },
    },
  )
  expect(state.ok()).toBe(true)
  const users = (await state.json()) as Array<{
    username: string
    data_limit: number
    used_traffic: number
    expire: number
  }>
  expect(users[0]).toMatchObject({
    username: 'e2e_qa_customer',
    data_limit: 20 * 1024 ** 3,
    used_traffic: 2 * 1024 ** 3,
  })
  expect(users[0]!.expire).toBeGreaterThan(Date.now() / 1000 + 29 * 86_400)
  expect(users[0]!.expire).toBeLessThan(Date.now() / 1000 + 31 * 86_400)
})

test('reseller UI never exposes archive actions', async ({ page }) => {
  await signIn(page)
  await page.locator('nav a[href$="/users"]').click()
  await page.getByRole('button', { name: 'عملیات' }).click()
  await expect(page.getByRole('button', { name: 'آرشیو کاربر' })).toHaveCount(0)
})
