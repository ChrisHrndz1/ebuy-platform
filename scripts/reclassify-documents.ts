import * as fs from 'fs'
import * as path from 'path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  fs.readFileSync(envPath, 'utf-8').split('\n').forEach((line) => {
    const t = line.trim()
    if (!t || t.startsWith('#')) return
    const i = t.indexOf('=')
    if (i === -1) return
    const k = t.slice(0, i).trim()
    if (!process.env[k]) process.env[k] = t.slice(i + 1).trim()
  })
}
loadEnvLocal()

// Re-runs the classifier on text already stored in Supabase. No downloads, no Claude calls.
async function run() {
  const { supabaseAdmin } = await import('../lib/supabase-server')
  const { classifyDocument } = await import('../lib/doc-reader')

  const { data: docs, error } = await supabaseAdmin
    .from('opportunity_documents')
    .select('id, filename, kind, text')
    .eq('status', 'ok')
  if (error || !docs) { console.error('Could not load documents:', error?.message); return }

  let changed = 0
  for (const d of docs) {
    const kind = !d.text || d.text.length < 200 ? 'other' : classifyDocument(d.filename, d.text)
    if (kind !== d.kind) {
      await supabaseAdmin.from('opportunity_documents').update({ kind }).eq('id', d.id)
      console.log(d.kind + ' -> ' + kind + ': ' + d.filename)
      changed++
    }
  }
  console.log('Done. Reclassified ' + changed + ' of ' + docs.length + ' documents.')
}
run()
