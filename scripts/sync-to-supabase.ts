import * as fs from 'fs'
import { fetchDocuments } from './fetch-documents'
import * as path from 'path'
import { chromium, Page } from 'playwright'

// Load .env.local manually since this runs outside Next.js's dev server
function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found at ' + envPath)
    return
  }
  const content = fs.readFileSync(envPath, 'utf-8')
  content.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (!process.env[key]) process.env[key] = value
  })
}
loadEnvLocal()
process.env.SOFT_SCORE_PATIENT = '1'

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

  const placeOfPerformanceParts = await page
    .$$eval('#rfq-display-shipping-addresses-wrap address', (addrs) =>
      addrs.map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
    )
    .catch(() => [] as string[])
  const placeOfPerformance = placeOfPerformanceParts.length > 0 ? placeOfPerformanceParts.join('; ') : null

  return { description, attachmentLinks, placeOfPerformance }
}

function detectFacilityClearance(attachmentNames: string[], description: string): boolean {
  const hasDD254 = attachmentNames.some((a) => /DD\s*-?\s*254/i.test(a))
  if (hasDD254) return true
  return /facility clearance|DD254|DD-254|secret facility|top secret facility/i.test(description)
}

function extractNaicsCode(description: string): string | null {
  const match = description.match(/NAICS(?:\s+code)?s?\s*:?\s*#?\s*(\d{6})/i)
  return match ? match[1] : null
}

function deriveSetAsideType(listingSource: string): string | null {
  if (!listingSource) return null
  if (/SB$/i.test(listingSource)) return 'Small Business Set-Aside'
  if (/UNR$/i.test(listingSource)) return 'Unrestricted'
  return listingSource
}

function parseListingDate(dateStr: string): string | null {
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})\s*(AM|PM)\s*(EDT|EST)/)
  if (!match) return null
  const [, month, day, year, hour, minute, ampm, tz] = match
  let hour24 = parseInt(hour, 10)
  if (ampm === 'PM' && hour24 !== 12) hour24 += 12
  if (ampm === 'AM' && hour24 === 12) hour24 = 0
  const offset = tz === 'EDT' ? 4 : 5
  const utcDate = new Date(Date.UTC(
    parseInt(year, 10),
    parseInt(month, 10) - 1,
    parseInt(day, 10),
    hour24 + offset,
    parseInt(minute, 10)
  ))
  return utcDate.toISOString()
}

async function run() {
  const { supabaseAdmin } = await import('../lib/supabase-server')
  const { evaluateHardGates, saveVerdict } = await import('../lib/qualification-engine')

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ storageState: SESSION_FILE })
  const page = await context.newPage()

  console.log('Loading listing...')
  const listing = await extractListing(page)
  console.log('Found ' + listing.length + ' opportunities. Processing each one...')

  let succeeded = 0
  let failed = 0

  for (const row of listing) {
    try {
      console.log('Processing ' + row.requestId + ': ' + row.title)
      const detail = await extractDetail(page, row.requestId)
      const facilityClearanceRequired = detectFacilityClearance(detail.attachmentLinks, detail.description)
      const naicsCode = extractNaicsCode(detail.description)
      const setAsideType = deriveSetAsideType(row.source)

      const { data, error } = await supabaseAdmin
        .from('opportunities')
        .upsert(
          {
            rfq_number: row.requestId,
            title: row.title,
            contract_number: CONTRACT_NUMBER,
            category: row.category,
            response_due: parseListingDate(row.close),
            full_description: detail.description,
            attachments: detail.attachmentLinks,
            facility_clearance_required: facilityClearanceRequired,
            naics_code: naicsCode,
            set_aside_type: setAsideType,
            place_of_performance: detail.placeOfPerformance,
            source: 'ebuy_scrape',
            parsed_fields: {
              buyerName: row.buyerName,
              buyerAgency: row.buyerAgency,
              buyerEmail: row.buyerEmail,
              listingSource: row.source,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'rfq_number' }
        )
        .select()
        .single()

      if (error) {
        console.error('  Supabase error for ' + row.requestId + ': ' + error.message)
        failed++
        continue
      }

      const docSummary = await fetchDocuments(page, supabaseAdmin, data.id)
      console.log('  Documents: ' + docSummary)

      const result = await evaluateHardGates(data)
      await saveVerdict(data.id, result, data)
      console.log('  Saved with verdict: ' + result.verdict)
      succeeded++

      await page.waitForTimeout(800)
    } catch (err) {
      console.error('  Failed to process ' + row.requestId + ': ' + (err as Error).message)
      failed++
    }
  }

  console.log('Done. Succeeded: ' + succeeded + ', Failed: ' + failed)
  await browser.close()
}

run()