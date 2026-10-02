import { chromium, Page } from 'playwright'

const CONTRACT_NUMBER = '47QRCA26DSG19'
const SESSION_FILE = 'ebuy-session-contract-1.json'

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

async function extractListing(page: Page): Promise<ListingRow[]> {
  await page.goto('https://www.ebuy.gsa.gov/ebuy/seller/active-rfqs')
  await page.waitForSelector('table')

  return page.$$eval('table tbody tr', (trs) => {
    return trs
      .map((tr) => {
        const cells = Array.from(tr.querySelectorAll('td')).map((td) => td.textContent?.trim() ?? '')
        if (!cells[2]) return null
        const buyerLines = (cells[6] ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
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
      .filter((r): r is NonNullable<typeof r> => r !== null)
  })
}

async function extractDetail(page: Page, requestId: string) {
  const url = 'https://www.ebuy.gsa.gov/ebuy/seller/prepare-quote/' + requestId + '?from=%2Fseller%2Factive-rfqs&contractNumber=' + CONTRACT_NUMBER
  await page.goto(url)
  await page.waitForSelector('#rfq-info-header-description', { timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(800)

  const descEl = await page.$('#rfq-info-header-description')
  const description = descEl ? (await descEl.textContent())?.trim() ?? '' : ''

  // Reveal any attachments hidden behind "Show More" before extracting
  const showMoreButton = page.locator('rfq-display-attachments-list button:has-text("Show More")')
  if ((await showMoreButton.count()) > 0) {
    await showMoreButton.first().click().catch(() => null)
    await page.waitForTimeout(500)
  }

  const attachmentLinks = await page
    .$$eval('#rfq-display-attachments-wrap a[id^="rfq-display-attachment-"]', (links) =>
      links.map((a) => a.getAttribute('title') || a.textContent?.trim() || '')
    )
    .catch(() => [] as string[])

  return { description, attachmentLinks }
}

function detectFacilityClearance(attachmentNames: string[], description: string): boolean {
  const hasDD254 = attachmentNames.some((a) => /DD\s*-?\s*254/i.test(a))
  if (hasDD254) return true
  return /facility clearance|DD254|DD-254|secret facility|top secret facility/i.test(description)
}

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ storageState: SESSION_FILE })
  const page = await context.newPage()

  console.log('Loading listing...')
  const listing = await extractListing(page)
  console.log('Found ' + listing.length + ' opportunities.')

  const targetIds = ['RFI1837266', 'RFP1838593']
  const targetRows = listing.filter((r) => targetIds.includes(r.requestId))

  console.log('Testing detail extraction on: ' + targetRows.map((r) => r.requestId).join(', '))

  const results = []
  for (const row of targetRows) {
    console.log('Fetching detail for ' + row.requestId + '...')
    const detail = await extractDetail(page, row.requestId)
    const facilityClearanceRequired = detectFacilityClearance(detail.attachmentLinks, detail.description)
    results.push({ ...row, ...detail, facilityClearanceRequired })
    await page.waitForTimeout(1000)
  }

  const fs = await import('fs')
  fs.writeFileSync('ebuy-full-scrape-test.json', JSON.stringify(results, null, 2))
  console.log('Saved to ebuy-full-scrape-test.json')

  await browser.close()
}

main()