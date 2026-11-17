import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { signIn } from './auth'

test('admin selects a single host, creates a template, and assigns it to a reseller’s existing users', async ({
  page,
  request,
}) => {
  await signIn(page, true)
  await page.goto('/admin/access')
  await expect(
    page.getByRole('heading', { name: 'مدیریت میزبان‌ها', exact: true }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'قالب‌ها', exact: true }).click()
  await page.getByRole('button', { name: 'قالب جدید', exact: true }).click()
  await page.getByLabel('نام قالب', { exact: true }).fill('Primary only')
  const hosts = page.getByRole('region', {
    name: 'میزبان‌های قالب',
    exact: true,
  })
  await hosts
    .getByRole('checkbox', { name: 'TCP host · VLESS TCP', exact: true })
    .check()
  await expect(
    hosts.getByRole('checkbox', {
      name: 'Backup host · VLESS TCP',
      exact: true,
    }),
  ).not.toBeChecked()
  await page
    .getByRole('button', { name: 'تخصیص به نمایندگان', exact: true })
    .click()
  await page
    .getByRole('checkbox', { name: 'انتخاب همه نمایندگان نمایان', exact: true })
    .check()
  await page
    .getByRole('button', { name: 'تخصیص به 1 نماینده', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'بازبینی و ذخیره', exact: true })
    .first()
    .click()
  const review = page.getByRole('dialog', { name: 'بازبینی تغییرات میزبان' })
  await expect(review.getByRole('status')).toContainText('1 کاربر')
  await review.getByRole('button', { name: 'تأیید و اعمال تغییرات' }).click()
  const operation = page
    .getByRole('region', { name: 'وضعیت اعمال دسترسی' })
    .first()
  await expect(operation).toBeVisible()
  const process = operation.getByRole('button', { name: 'پردازش یک دسته' })
  if (await process.isVisible()) await process.click()
  await expect(operation.getByRole('status')).toContainText('اعمال‌شده: 1')
  await page.goto('/users')
  await page
    .getByRole('table')
    .getByRole('button', { name: 'تمدید / ویرایش' })
    .first()
    .click()
  await page.getByRole('tab', { name: 'دسترسی اتصال' }).click()
  await expect(
    page
      .getByRole('region', { name: 'میزبان‌های اتصال' })
      .getByRole('checkbox', { name: 'TCP host · VLESS TCP', exact: true }),
  ).toBeChecked()
  await expect(
    page
      .getByRole('region', { name: 'میزبان‌های اتصال' })
      .getByRole('checkbox', { name: 'Backup host · VLESS TCP', exact: true }),
  ).not.toBeChecked()
  const result = await request.post('/api/vpnUsers/list', {
    data: { page: 1, pageSize: 20 },
    headers: {
      cookie: (await page.context().cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join('; '),
    },
  })
  expect(result.ok()).toBe(true)
  const body = await result.json()
  // oRPC OpenAPI responses expose the handler payload directly.
  const url =
    body.items?.[0]?.subscriptionUrl ?? body.json?.items?.[0]?.subscriptionUrl
  expect(url).toContain('/subscription/')
  const subscription = await request.get(url)
  expect(subscription.status()).toBe(200)
  const content = Buffer.from(await subscription.text(), 'base64').toString()
  expect(content).toContain('tcp.example.test')
  expect(content).not.toContain('backup.example.test')
})
test('resellers cannot see access controls or call the access API', async ({
  page,
  request,
}) => {
  await signIn(page)
  await page.goto('/users')
  await page
    .getByRole('table')
    .getByRole('button', { name: 'تمدید / ویرایش' })
    .first()
    .click()
  await expect(page.getByRole('tab', { name: 'دسترسی اتصال' })).toHaveCount(0)
  await page.getByRole('button', { name: 'انصراف', exact: true }).click()
  await page.getByRole('button', { name: 'ایجاد کاربر', exact: true }).click()
  await expect(page.getByLabel('روش انتخاب دسترسی')).toHaveCount(0)
  const response = await request.post('/api/access/catalog', {
    data: {},
    headers: {
      cookie: (await page.context().cookies())
        .map((c) => `${c.name}=${c.value}`)
        .join('; '),
    },
  })
  expect(response.status()).toBe(403)
  await page.goto('/admin/access')
  await expect(page).toHaveURL(/dashboard/)
})
test('host management uses full width, supports keyboard selection, mobile and accessible English controls', async ({
  page,
}) => {
  await signIn(page, true, true)
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/en/admin/access')
  await expect(
    page.getByRole('heading', { name: 'Host management', exact: true }),
  ).toBeVisible()
  const workspace = page.getByTestId('access-workspace')
  const bounds = await workspace.boundingBox()
  expect(bounds!.width).toBeGreaterThan(1500)
  await page
    .getByLabel('Apply selection to', { exact: true })
    .selectOption('required')
  const table = page.getByRole('region', {
    name: 'Required hosts',
    exact: true,
  })
  const selectAll = table.getByRole('checkbox', {
    name: 'Select all shown hosts',
  })
  await selectAll.focus()
  await page.keyboard.press('Space')
  await expect(
    table.getByRole('checkbox', { name: 'TCP host · VLESS TCP', exact: true }),
  ).toBeChecked()
  await expect(
    table.getByRole('checkbox', {
      name: 'Backup host · VLESS TCP',
      exact: true,
    }),
  ).toBeChecked()
  await table
    .getByRole('checkbox', { name: 'Backup host · VLESS TCP', exact: true })
    .uncheck()
  await expect(selectAll).toHaveAttribute('aria-checked', 'mixed')
  await page.screenshot({
    path: test.info().outputPath('host-workspace-desktop.png'),
    fullPage: true,
  })
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-testid="access-workspace"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.locator('body').evaluate((el) => el.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page.screenshot({
    path: test.info().outputPath('host-workspace-mobile.png'),
    fullPage: true,
  })
  expect(
    (
      await new AxeBuilder({ page })
        .include('[data-testid="access-workspace"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze()
    ).violations,
  ).toEqual([])
})
