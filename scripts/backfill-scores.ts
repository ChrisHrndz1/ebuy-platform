import * as fs from 'fs'
import * as path from 'path'

function loadEnvLocal() {
  const envPath = path.resolve(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) {
    console.error('.env.local not found at ' + envPath)
    return
  }
  fs.readFileSync(envPath, 'utf-8')
    .split('\n')
    .forEach((line) => {
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

async function run() {
  const { supabaseAdmin } = await import('../lib/supabase-server')
  const { evaluateHardGates, saveVerdict } = await import('../lib/qualification-engine')

  const { data: opportunities, error } = await supabaseAdmin.from('opportunities').select('*')
  if (error || !opportunities) {
    console.error('Could not load opportunities:', error?.message)
    return
  }

  const { data: verdicts } = await supabaseAdmin
    .from('verdicts')
    .select('*')
    .order('created_at', { ascending: false })

  const latestByOpp = new Map<string, { soft_score: number | null; verdict: string }>()
  verdicts?.forEach((v) => {
    if (!latestByOpp.has(v.opportunity_id)) latestByOpp.set(v.opportunity_id, v)
  })

  const todo = opportunities.filter((o) => {
    const v = latestByOpp.get(o.id)
    return !v || (v.soft_score === null && v.verdict !== 'pass')
  })

  console.log('Re-scoring ' + todo.length + ' of ' + opportunities.length + ' opportunities...')

  let scored = 0
  let stillMissing = 0

  for (const opp of todo) {
    console.log('Scoring ' + opp.rfq_number + ': ' + opp.title)
    const result = await evaluateHardGates(opp)
    await saveVerdict(opp.id, result, opp)

    const { data: check } = await supabaseAdmin
      .from('verdicts')
      .select('soft_score')
      .eq('opportunity_id', opp.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (check?.soft_score !== null && check?.soft_score !== undefined) {
      scored++
    } else {
      stillMissing++
    }
        await new Promise((r) => setTimeout(r, 1000))
  }

  console.log('Done. Scored: ' + scored + ', still missing a score: ' + stillMissing)
}

run()