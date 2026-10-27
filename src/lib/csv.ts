/** Prefix cells that spreadsheets would execute as formulas. */
function guard(value: string) {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

function cell(value: unknown) {
  const text = value == null ? '' : guard(String(value))
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 CSV with a UTF-8 BOM so Excel reads Persian text correctly. */
export function toCsv(rows: Array<Array<unknown>>) {
  return '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        field += ch
      }
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((c) => c !== '')) rows.push(row)
      row = []
    } else {
      field += ch
    }
  }
  if (quoted) throw new Error('Unterminated quoted field')
  row.push(field)
  if (row.some((c) => c !== '')) rows.push(row)
  return rows
}
