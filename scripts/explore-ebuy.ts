import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ storageState: 'ebuy-session.json' })
  const page = await context.newPage()

  await page.goto('https://www.ebuy.gsa.gov/ebuy/')

  console.log('Browser opened using your saved session.')
  console.log('Navigate to one of your contract views, then click into one real opportunity.')
  console.log('Once you are looking at that opportunity\'s full detail page, come back here and press Enter.')

  await new Promise((resolve) => {
    process.stdin.once('data', resolve)
  })

  const url = page.url()
  const html = await page.content()

  const fs = await import('fs')
  fs.writeFileSync('ebuy-page-dump.html', html)
  await page.screenshot({ path: 'ebuy-page-detail.png', fullPage: true })

  console.log('Current URL:', url)
  console.log('Saved full HTML to ebuy-page-dump.html')
  console.log('Saved screenshot to ebuy-page-detail.png')

  await browser.close()
}

main()