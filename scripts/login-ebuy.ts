import { chromium } from 'playwright'

async function main() {
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto('https://www.ebuy.gsa.gov/ebuy/')

  console.log('A browser window has opened.')
  console.log('Log in fully: email, password, MFA, then select ONE contract from the dropdown.')
  console.log('Once you are looking at that contract\'s active-rfqs list, come back here and press Enter.')

  await new Promise((resolve) => {
    process.stdin.once('data', resolve)
  })

  await context.storageState({ path: 'ebuy-session-contract-1.json' })
  console.log('Session saved to ebuy-session-contract-1.json')

  await browser.close()
}

main()