import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

// Reuse session credentials across fresh test contexts without bypassing production rate limits.
const sessions = new Map<
  string,
  Awaited<ReturnType<BrowserContext['storageState']>>
>()
export async function signIn(page: Page, admin = false, english = false) {
  const role = admin ? 'admin' : 'reseller'
  const saved = sessions.get(role)
  if (saved) {
    await page.context().addCookies(saved.cookies)
  } else {
    await page.goto('/login')
    await page.getByLabel('ایمیل').fill(`${role}.e2e@example.test`)
    await page.getByLabel('رمز عبور').fill('E2E-only-password-12345')
    await page.getByRole('button', { name: 'ورود', exact: true }).click()
    await expect(page).toHaveURL(/dashboard/)
    sessions.set(role, await page.context().storageState())
  }
  const baseURL = String(test.info().project.use.baseURL)
  await page
    .context()
    .addCookies([
      { name: 'marzgah-locale', value: english ? 'en' : 'fa', url: baseURL },
    ])
  await page.goto(english ? '/en/dashboard' : '/dashboard')
  await expect(page).toHaveURL(/dashboard/)
}
