import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './select'
import { createTranslator } from '#/lib/i18n/core'

function triggerText(markup: string) {
  const match = markup.match(
    /<span[^>]*data-slot="select-value"[^>]*>([\s\S]*?)<\/span>/,
  )
  return match?.[1].replace(/<[^>]*>/g, '')
}

test('renders the selected reseller label before the popup has mounted', () => {
  const markup = renderToStaticMarkup(
    <Select
      defaultValue="reseller-123"
      items={[{ value: 'reseller-123', label: 'Sample reseller' }]}
      name="resellerId"
    >
      <SelectTrigger>
        <SelectValue placeholder="Choose reseller" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="reseller-123">Sample reseller</SelectItem>
      </SelectContent>
    </Select>,
  )
  expect(triggerText(markup)).toBe('Sample reseller')
  // Display labels must not replace the actual value submitted to the server.
  expect(markup).toContain('value="reseller-123"')
})

test.each(['fa', 'en'] as const)(
  'renders translated status labels in %s',
  (locale) => {
    const t = createTranslator(locale)
    const markup = renderToStaticMarkup(
      <Select value="outstanding" items={{ outstanding: t('بدهی') }}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
      </Select>,
    )
    expect(triggerText(markup)).toBe(t('بدهی'))
    expect(triggerText(markup)).not.toBe('outstanding')
  },
)

test('keeps the placeholder when no item is selected', () => {
  const markup = renderToStaticMarkup(
    <Select items={[]}>
      <SelectTrigger>
        <SelectValue placeholder="Choose reseller" />
      </SelectTrigger>
    </Select>,
  )
  expect(triggerText(markup)).toBe('Choose reseller')
})

test('renders localized page sizes instead of the stored numeric string', () => {
  const markup = renderToStaticMarkup(
    <Select value="20" items={{ '20': '۲۰ در صفحه' }}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
    </Select>,
  )
  expect(triggerText(markup)).toBe('۲۰ در صفحه')
})

test('supports a controlled empty selection before options load', () => {
  const markup = renderToStaticMarkup(
    <Select value={null} items={[]} name="resellerId">
      <SelectTrigger>
        <SelectValue placeholder="Choose reseller" />
      </SelectTrigger>
    </Select>,
  )
  expect(triggerText(markup)).toBe('Choose reseller')
  expect(markup).not.toContain('value="null"')
})
