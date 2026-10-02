import { chromium } from 'playwright'

interface ListingRow {
  source: string
  category: string
  requestId: string
  title: string
  posted: string
  close: string
  buyerName: string
  buyerAgency: string
  buyerEmail: string
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ storageState: 'ebuy-session-contract-1.json' })
  const page = await context.newPage()

  await page.goto('https://www.ebuy.gsa.gov/ebuy/seller/active-rfqs')
  await page.waitForSelector('table')

  const rows: ListingRow[] = await page.$$eval('table tbody tr', (trs) => {
    return trs
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '')
        if (!cells[2]) return null // skip rows with no Request ID (header/empty rows)

        const buyerLines = (cells[6] ?? '')
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l.length > 0)

        return {
          source: cells[0] ?? '',
          category: cells[1] ?? '',
          requestId: cells[2] ?? '',
          title: cells[3] ?? '',
          posted: cells[4] ?? '',
          close: cells[5] ?? '',
          buyerName: buyerLines[0] ?? '',
          buyerAgency: buyerLines[1] ?? '',
          buyerEmail: buyerLines[2] ?? '',
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
  })

  console.log('Extracted', rows.length, 'clean rows:')
  console.log(JSON.stringify(rows, null, 2))

  const fs = await import('fs')
  fs.writeFileSync('ebuy-extracted-rows.json', JSON.stringify(rows, null, 2))
  console.log('Saved to ebuy-extracted-rows.json')

  await browser.close()
}

main()