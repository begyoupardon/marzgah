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

  test('URL and path internationalization rewrites', () => {
    const {
      isSystemPath,
      extractLocaleFromPath,
      deLocalizePath,
      localizePath,
      deLocalizeUrl,
      localizeUrl,
    } = require('./core')

    // System paths
    expect(isSystemPath('/api/health')).toBe(true)
    expect(isSystemPath('/api/rpc/tools.announcement')).toBe(true)
    expect(isSystemPath('/_serverFn/abc123')).toBe(true)
    expect(isSystemPath('/assets/styles.css')).toBe(true)
    expect(isSystemPath('/favicon.ico')).toBe(true)
    expect(isSystemPath('/site.webmanifest')).toBe(true)
    expect(isSystemPath('/dashboard')).toBe(false)
    expect(isSystemPath('/s/mytoken123')).toBe(false)
    expect(isSystemPath('/en/dashboard')).toBe(false)

    // Locale extraction from path
    expect(extractLocaleFromPath('/en/dashboard')).toBe('en')
    expect(extractLocaleFromPath('/en')).toBe('en')
    expect(extractLocaleFromPath('/fa/login')).toBe('fa')
    expect(extractLocaleFromPath('/fa')).toBe('fa')
    expect(extractLocaleFromPath('/dashboard')).toBeNull()
    expect(extractLocaleFromPath('/')).toBeNull()
    expect(extractLocaleFromPath('/api/health')).toBeNull()

    // De-localization (Input rewrite)
    expect(deLocalizePath('/en/dashboard')).toBe('/dashboard')
    expect(deLocalizePath('/en/s/token123')).toBe('/s/token123')
    expect(deLocalizePath('/en')).toBe('/')
    expect(deLocalizePath('/fa/login')).toBe('/login')
    expect(deLocalizePath('/login')).toBe('/login')
    expect(deLocalizePath('/api/health')).toBe('/api/health')

    const inUrl = new URL('http://localhost:3000/en/users?view=expiring#filter')
    expect(deLocalizeUrl(inUrl).pathname).toBe('/users')
    expect(inUrl.search).toBe('?view=expiring')
    expect(inUrl.hash).toBe('#filter')

    // Localization (Output rewrite)
    expect(localizePath('/dashboard', 'en')).toBe('/en/dashboard')
    expect(localizePath('/s/token123', 'en')).toBe('/en/s/token123')
    expect(localizePath('/', 'en')).toBe('/en')
    expect(localizePath('/dashboard', 'fa')).toBe('/dashboard')
    expect(localizePath('/en/dashboard', 'fa')).toBe('/dashboard')
    expect(localizePath('/', 'fa')).toBe('/')
    expect(localizePath('/api/health', 'en')).toBe('/api/health')
    expect(localizePath('/favicon.ico', 'en')).toBe('/favicon.ico')

    const outUrl = new URL('http://localhost:3000/dashboard')
    expect(localizeUrl(outUrl, 'en').pathname).toBe('/en/dashboard')
    expect(
      localizeUrl(new URL('http://localhost:3000/en/dashboard'), 'en').pathname,
    ).toBe('/en/dashboard')
    expect(
      localizeUrl(new URL('http://localhost:3000/en/dashboard'), 'fa').pathname,
    ).toBe('/dashboard')
  })
})
