import { chromium } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

// Probe: click ONE attachment on ONE opportunity and report how eBuy delivers it.
// Saves nothing permanently: any download goes to the OS temp folder and is deleted immediately.
const REQUEST_ID = process.argv[2] || 'RFP1838593'
const CONTRACT = '47QRCA26DSG19'
const SESSION_FILE = 'ebuy-session-contract-1.json'

async function run() {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({ storageState: SESSION_FILE, acceptDownloads: true })
  const page = await context.newPage()

  const url =
    'https://www.ebuy.gsa.gov/ebuy/seller/prepare-quote/' + REQUEST_ID +
    '?from=%2Fseller%2Factive-rfqs&contractNumber=' + CONTRACT
  await page.goto(url, { waitUntil: 'domcontentloaded' })

  try {
    await page.waitForSelector('#rfq-display-attachments-wrap', { timeout: 30000 })
  } catch {
    console.log('Could not find the attachments area. Session probably expired (log in again with login-ebuy.ts). Current page: ' + new URL(page.url()).pathname)
    await browser.close()
    return
  }

  const links = page.locator('#rfq-display-attachments-wrap a[id^="rfq-display-attachment-"]')
  const count = await links.count()
  console.log('Attachment links visible: ' + count)
  if (count === 0) { await browser.close(); return }
  console.log('Clicking first: ' + (await links.first().getAttribute('title')))

  const seen: string[] = []
  page.on('response', (r) => {
    const ct = r.headers()['content-type'] || ''
    if (/pdf|word|officedocument|octet-stream|excel/i.test(ct)) {
      seen.push(r.status() + ' ' + ct + ' ' + new URL(r.url()).origin + new URL(r.url()).pathname)
    }
  })

  const downloadP = page.waitForEvent('download', { timeout: 20000 }).catch(() => null)
  const popupP = context.waitForEvent('page', { timeout: 20000 }).catch(() => null)
  await links.first().click()
  const [download, popup] = await Promise.all([downloadP, popupP])

  if (download) {
    const tmp = path.join(os.tmpdir(), 'ebuy-probe-' + Date.now())
    await download.saveAs(tmp)
    const size = fs.statSync(tmp).size
    const head = fs.readFileSync(tmp).subarray(0, 5).toString('latin1')
    fs.unlinkSync(tmp)
    console.log('RESULT: direct download event. filename=' + download.suggestedFilename() + ' bytes=' + size + ' header=' + JSON.stringify(head) + ' (temp file deleted)')
  } else if (popup) {
    await popup.waitForLoadState('domcontentloaded').catch(() => null)
    const u = new URL(popup.url())
    console.log('RESULT: opened a new tab at ' + u.origin + u.pathname)
  } else {
    console.log('RESULT: neither a download nor a new tab happened.')
  }
  if (seen.length) console.log('Document-type responses seen:\n  ' + seen.join('\n  '))
  await browser.close()
}
run()
