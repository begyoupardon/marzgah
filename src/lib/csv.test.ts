import { expect, it } from 'bun:test'

import { parseCsv, toCsv } from './csv'

it('round-trips quotes, commas, newlines and Persian text', () => {
  const rows = [
    ['name', 'note'],
    ['علی', 'a,"b"\nc'],
    ['x', ''],
  ]
  expect(parseCsv(toCsv(rows))).toEqual(rows)
})

it('neutralizes spreadsheet formulas', () => {
  const csv = toCsv([['=HYPERLINK("http://evil")', '+1', '-2', '@x', 'ok']])
  const [row] = parseCsv(csv)
  expect(row).toEqual([
    '\'=HYPERLINK("http://evil")',
    "'+1",
    "'-2",
    "'@x",
    'ok',
  ])
})

it('handles CRLF, a BOM and blank lines', () => {
  expect(parseCsv('﻿a,b\r\n\r\n1,2\r\n')).toEqual([
    ['a', 'b'],
    ['1', '2'],
  ])
})

it('rejects an unterminated quote', () => {
  expect(() => parseCsv('a,"b')).toThrow()
})
