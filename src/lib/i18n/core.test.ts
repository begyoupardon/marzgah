import { describe, expect, test } from 'bun:test'
import { createTranslator, directionFor, normalizeLocale } from './core'
import { formatBytes, formatDate, formatToman } from '#/lib/format'
import english from './en.json'

describe('localization', () => {
  test('keeps simultaneous locales independent', () => {
    const fa = createTranslator('fa')
    const en = createTranslator('en')
    expect(en('داشبورد')).toBe('Dashboard')
    expect(fa('داشبورد')).toBe('داشبورد')
    expect(en('داشبورد')).toBe('Dashboard')
    expect(normalizeLocale('unexpected')).toBe('fa')
    expect(directionFor('en')).toBe('ltr')
    expect(directionFor('fa')).toBe('rtl')
  })
  test('interpolates without changing customer data or interpreting HTML', () => {
    const en = createTranslator('en')
    expect(en('حساب کاربری {0}', { 0: 'مدیر' })).toBe('Account: مدیر')
    expect(en('کاربر: {0}', { 0: '<script>alert(1)</script>' })).toBe(
      'User: <script>alert(1)</script>',
    )
    expect(en('Unrecognized customer note')).toBe('Unrecognized customer note')
  })
  test('translates server validation templates', () => {
    expect(createTranslator('en')('حجم باید حداقل 1 گیگابایت باشد')).toBe(
      'Data allowance must be at least 1 GB',
    )
  })
  test('every translation preserves its interpolation parameters', () => {
    for (const [source, translated] of Object.entries(english)) {
      expect(translated.trim().length, source).toBeGreaterThan(0)
      expect(translated.match(/\{\w+\}/g)?.sort() ?? [], source).toEqual(
        source.match(/\{\w+\}/g)?.sort() ?? [],
      )
    }
  })
  test('formats units and currency in the chosen locale', () => {
    expect(formatBytes(1024, 'en')).toBe('1 KB')
    expect(formatBytes(0, 'en')).toBe('0 bytes')
    expect(formatBytes(1024, 'fa')).toContain('کیلوبایت')
    expect(formatToman(12500, 'en')).toBe('12,500 toman')
    expect(formatToman(12500, 'fa')).toContain('تومان')
    expect(formatDate('2026-10-27T12:00:00Z', 'en')).toContain('2026')
    expect(formatDate('2026-10-27T12:00:00Z', 'fa')).toContain('۱۴۰۵')
    expect(formatDate('invalid', 'en')).toBe('—')
  })
})
