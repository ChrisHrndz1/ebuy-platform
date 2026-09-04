import * as cheerio from 'cheerio'

export interface ParsedRequest {
  requestId: string
  status: string
  dateBuyer: string
  dueBy: string
  title: string
}

export function parseContractNumber(subject: string): string | null {
  const match = subject.match(/GS-\d{2}F-\d{4}[A-Z]?/)
  return match ? match[0] : null
}

export function parseEbuyRequests(html: string): ParsedRequest[] {
  const $ = cheerio.load(html)
  const results: ParsedRequest[] = []

  $('table').each((_, table) => {
    const headerCells = $(table).find('tr').first().find('th').map((_, el) => $(el).text().trim()).get()

    const isRequestsTable =
      headerCells.includes('Request ID') && headerCells.includes('Request Title')

    if (!isRequestsTable) return

    $(table).find('tr').slice(1).each((_, row) => {
      const cells = $(row).find('td').map((_, el) => $(el).text().trim()).get()
      if (cells.length < 5) return // skips the "No Quote/Bid Notice Received" colspan row

      const [requestId, status, dateBuyer, dueBy, title] = cells
      results.push({ requestId, status, dateBuyer, dueBy, title })
    })
  })

  return results
}

export function parseEbuyDate(dateStr: string): string | null {
  // e.g. "09/04/2026 01:00 PM EDT"
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s*(AM|PM)\s*(EDT|EST)/)
  if (!match) return null

  const [, month, day, year, hour, minute, ampm, tz] = match
  let hour24 = parseInt(hour, 10)
  if (ampm === 'PM' && hour24 !== 12) hour24 += 12
  if (ampm === 'AM' && hour24 === 12) hour24 = 0

  const offset = tz === 'EDT' ? 4 : 5 // hours behind UTC
  const utcDate = new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    hour24 + offset,
    parseInt(minute, 10)
  ))

  return utcDate.toISOString()
}