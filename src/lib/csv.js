/**
 * Minimal RFC 4180 CSV writer and reader.
 */

/**
 * Spreadsheet apps execute cells that start with = + - @ (and tab/CR) as
 * formulas ("CSV injection"). Prefix such text with an apostrophe so it is
 * shown as text. Plain numbers like -5 are left alone.
 */
export function neutralizeFormula(value) {
  if (/^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value)) return `'${value}`
  return value
}

export function escapeCell(cell) {
  if (cell === null || cell === undefined) return ''
  const text = neutralizeFormula(String(cell))
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers, rows) {
  // CRLF line endings and a BOM so Excel opens UTF-8 names correctly.
  const lines = [headers, ...rows].map((r) => r.map(escapeCell).join(','))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Parse CSV text into rows of strings. Handles quotes, escaped quotes and newlines in quotes. */
export function parseCsv(text) {
  const input = text.replace(/^﻿/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += ch
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Trigger a browser download of CSV text. */
export function downloadCsv(filename, csv) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
