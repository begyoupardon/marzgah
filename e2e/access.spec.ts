import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { signIn } from './auth'
test('admin previews global requirements, applies a batch, and sees locked user access', async ({
  page,
}) => {
  await signIn(page, true)
  await page.locator('nav a[href$="/admin/access"]').click()
  await expect(
    page.getByRole('heading', { name: 'دسترسی اتصال', exact: true }),
  ).toBeVisible()
  const requirements = page.getByRole('group', {
    name: 'اینباندهای الزامی',
    exact: true,
  })
  await requirements.getByRole('checkbox', { name: /VLESS WS/ }).check()
  await page
    .getByRole('button', { name: 'پیش‌نمایش تغییرات', exact: true })
    .click()
  await expect(
    page.getByRole('region', { name: 'تأیید تغییرات دسترسی' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'تأیید و اعمال تغییرات', exact: true })
    .click()
  const operation = page
    .getByRole('region', { name: 'وضعیت اعمال دسترسی' })
    .first()
  await expect(operation).toBeVisible()
  const process = operation.getByRole('button', { name: 'پردازش یک دسته' })
  if (await process.isVisible()) await process.click()
  await expect(operation.getByRole('status')).toContainText('اعمال‌شده: 1')
  await page.locator('nav a[href$="/users"]').click()
  await page
    .getByRole('table')
    .getByRole('button', { name: 'تمدید / ویرایش' })
    .first()
    .click()
  await page.getByRole('tab', { name: 'دسترسی اتصال' }).click()
  const inbounds = page.getByRole('group', { name: 'اینباندهای اتصال' })
  await expect(
    inbounds.getByRole('checkbox', { name: /VLESS WS/ }),
  ).toBeDisabled()
  await expect(
    inbounds.getByRole('checkbox', { name: /VLESS TCP/ }),
  ).toBeChecked()
})
test('reseller access editor works with keyboard, mobile and accessible labels', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/users')
  await page
    .getByRole('table')
    .getByRole('button', { name: 'تمدید / ویرایش' })
    .first()
    .click()
  await page.getByRole('tab', { name: 'دسترسی اتصال' }).click()
  await page.getByLabel('روش انتخاب دسترسی').selectOption('custom')
  const search = page.getByLabel('جستجوی اینباند یا میزبان')
  await search.fill('VLESS TCP')
  const checkbox = page.getByRole('checkbox', { name: /VLESS TCP/ })
  await checkbox.focus()
  await page.keyboard.press('Space')
  await page.keyboard.press('Space')
  await expect(checkbox).toBeChecked()
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByRole('button', { name: 'ذخیره دسترسی اتصال' }),
  ).toBeVisible()
  expect(
    await page.locator('body').evaluate((el) => el.scrollWidth),
  ).toBeLessThanOrEqual(390)
  await page
    .getByRole('button', { name: 'ذخیره دسترسی اتصال' })
    .scrollIntoViewIfNeeded()
  await page.screenshot({
    path: test.info().outputPath('access-mobile.png'),
    fullPage: true,
  })
  const report = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(report.violations).toEqual([])
})
test('English access administration has translated controls and no accessibility violations', async ({
  page,
}) => {
  await signIn(page, true, true)
  await page.goto('/en/admin/access')
  await expect(
    page.getByRole('heading', { name: 'Connection access', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Preview changes', exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: test.info().outputPath('access-admin.png'),
    fullPage: true,
  })
  const report = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze()
  expect(report.violations).toEqual([])
})
