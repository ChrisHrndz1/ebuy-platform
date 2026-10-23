import type { Page } from 'playwright'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { classifyDocument, extractText, skipReasonForName } from '../lib/doc-reader'

const MAX_FILES_PER_OPPORTUNITY = 15
const MAX_BYTES = 40 * 1024 * 1024

// Call while the browser is ON an opportunity's detail page (after "Show More" has been clicked).
// Downloads each attachment into the OS temp folder, extracts text, deletes the file right away,
// and stores ONLY the extracted text in Supabase (table: opportunity_documents).
// Files already stored for this opportunity are not downloaded again.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchDocuments(page: Page, supabaseAdmin: any, opportunityId: string): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from('opportunity_documents')
    .select('filename, status')
    .eq('opportunity_id', opportunityId)
  const done = new Set<string>(
    (existing ?? []).filter((r: { status: string }) => r.status === 'ok' || r.status === 'skipped').map((r: { filename: string }) => r.filename)
  )

  const links = page.locator('#rfq-display-attachments-wrap a[id^="rfq-display-attachment-"]')
  const count = Math.min(await links.count(), MAX_FILES_PER_OPPORTUNITY)
  const counts: Record<string, number> = {}
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1)

  for (let i = 0; i < count; i++) {
    const filename = (await links.nth(i).getAttribute('title')) || 'attachment-' + i
    if (done.has(filename)) { bump('already stored'); continue }

    const skip = skipReasonForName(filename)
    if (skip.skip) {
      await supabaseAdmin.from('opportunity_documents').upsert(
        { opportunity_id: opportunityId, filename, kind: skip.kind, status: 'skipped', text: null, char_count: 0 },
        { onConflict: 'opportunity_id,filename' }
      )
      bump('skipped')
      continue
    }

    const tmp = path.join(os.tmpdir(), 'ebuy-doc-' + Date.now() + '-' + i)
    try {
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), links.nth(i).click()])
      await download.saveAs(tmp)
      if (fs.statSync(tmp).size > MAX_BYTES) throw new Error('file too large')
      const buffer = fs.readFileSync(tmp)
      const { text, pages } = await extractText(buffer, filename)
      const kind = text.length < 200 ? 'other' : classifyDocument(filename, text)
      await supabaseAdmin.from('opportunity_documents').upsert(
        {
          opportunity_id: opportunityId,
          filename,
          kind,
          status: text.length < 200 ? 'error' : 'ok',
          page_count: pages,
          char_count: text.length,
          text: text || null,
        },
        { onConflict: 'opportunity_id,filename' }
      )
      bump(text.length < 200 ? 'no text (scanned?)' : kind)
    } catch (err) {
      await supabaseAdmin.from('opportunity_documents').upsert(
        { opportunity_id: opportunityId, filename, kind: 'other', status: 'error', text: null, char_count: 0 },
        { onConflict: 'opportunity_id,filename' }
      )
      bump('error')
      console.error('    could not read "' + filename + '": ' + (err as Error).message)
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    }
    await page.waitForTimeout(400)
  }

  return Object.entries(counts).map(([k, v]) => v + ' ' + k).join(', ') || 'no attachments'
}
