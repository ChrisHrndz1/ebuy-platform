import { supabaseAdmin } from './supabase-server'

export interface SoftScoreResult {
  score: number // FIT, 0-100 (stored in verdicts.soft_score)
  rationale: string
  gaps: string[]
  valueLow: number | null
  valueHigh: number | null
  valueBasis: 'stated' | 'estimated' | 'unknown'
  valueNote: string | null
  liftLevel: 'low' | 'moderate' | 'high' | 'unknown'
  liftNotes: string | null
}

const CLAUDE_MODEL = 'claude-sonnet-5'

// Used ONLY to estimate deal value when the documents do not state hours or a ceiling.
// Placeholder until the real blended bill rate is supplied - edit these two numbers.
const ASSUMED_BLENDED_RATE = 150
const HOURS_PER_FTE_YEAR = 1920

// Things eTel has NOT done, or does not want. Add lines as you learn them.
// Example: 'Network security engineering (Palo Alto, firewalls)'
const KNOWN_GAPS_AND_NO_GOS: string[] = []

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function computeSoftScore(opportunity: {
  id?: string
  title: string | null
  raw_email: string | null
  contract_number: string | null
  full_description?: string | null
  response_due?: string | null
  naics_code?: string | null
  set_aside_type?: string | null
  place_of_performance?: string | null
  attachments?: string[] | null
}): Promise<SoftScoreResult | null> {
  const { data: pastPerformance } = await supabaseAdmin.from('past_performance').select('*')
  const { data: certifications } = await supabaseAdmin.from('certifications').select('*')
  const { data: vehicles } = await supabaseAdmin.from('vehicles').select('*')
  const { data: naicsCodes } = await supabaseAdmin.from('naics_codes').select('*')
  const { data: capabilities } = await supabaseAdmin.from('capabilities').select('*')

  const companyProfile = {
    vehicles: vehicles?.map((v) => v.name + (v.awarded === false ? ' (pending award)' : '')),
    certifications: certifications?.map((c) => c.cert_type),
    naicsCodes: naicsCodes?.map((n) => n.code + (n.notes ? ' - ' + n.notes : '')),
    capabilities: capabilities?.map((c) => c.area + ': ' + c.detail),
    pastPerformance: pastPerformance?.map((p) => ({
      name: p.contract_name,
      agency: p.agency,
      value: p.contract_value,
      period: (p.period_start ?? '?') + ' to ' + (p.period_end ?? '?'),
      outcome: p.outcome,
      summary: p.summary,
    })),
    knownGapsAndNoGos: KNOWN_GAPS_AND_NO_GOS,
  }

  // Full text of the solicitation documents that matter (PWS, instructions), if the sync has stored them.
  let documentsSection = ''
  if (opportunity.id) {
    const { data: docs } = await supabaseAdmin
      .from('opportunity_documents')
      .select('filename, kind, status, text')
      .eq('opportunity_id', opportunity.id)
    const rows = docs ?? []
    const readable = rows.filter((d) => d.status === 'ok' && d.text)
    const important = readable.filter((d) => ['pws', 'instructions', 'combined', 'notice'].includes(d.kind))

    // Drop duplicate versions of the same document (v2 / Final / Draft...), keeping the longest.
    const norm = (f: string) =>
      f.toLowerCase().replace(/\.[a-z]+$/, '').replace(/\b(v\d+(\.\d+)?|final|draft|edit version|copy|rev\s*\d+)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const byName = new Map<string, (typeof important)[number]>()
    for (const d of important) {
      const k = norm(d.filename)
      const prev = byName.get(k)
      if (!prev || (d.text as string).length > (prev.text as string).length) byName.set(k, d)
    }
    const rank = (k: string) => (k === 'instructions' || k === 'combined' ? 0 : k === 'pws' ? 1 : 2)
    const selected = [...byName.values()].sort(
      (x, y) => rank(x.kind) - rank(y.kind) || (x.text as string).length - (y.text as string).length
    )
    const chosen = selected.length > 0 ? selected : readable
    const capFor = (k: string) => (selected.length === 0 ? 20000 : k === 'pws' ? 70000 : k === 'notice' ? 15000 : 50000)

    let budget = 150000
    const parts: string[] = []
    for (const d of chosen) {
      const cap = Math.min(capFor(d.kind), budget)
      if (cap <= 0) break
      const text = (d.text as string).slice(0, cap)
      budget -= text.length
      parts.push('--- DOCUMENT: ' + d.filename + ' (classified: ' + d.kind + (text.length < (d.text as string).length ? ', truncated' : '') + ') ---\n' + text)
    }
    const skipped = rows.filter((d) => d.status !== 'ok').map((d) => d.filename + ' [' + d.kind + ']')
    if (parts.length > 0) {
      documentsSection =
        'FULL TEXT OF SOLICITATION DOCUMENTS (authoritative: prefer this over the short posted description; ' +
        'take volumes, page limits, key personnel, evaluation approach, hours or ceilings from here when present):\n' +
        parts.join('\n\n') + '\n\n' +
        (skipped.length ? 'Other files not read (pricing sheets, forms, spreadsheets, unreadable): ' + skipped.join('; ') + '\n\n' : '')
    }
  }

  const requirementText = opportunity.full_description || opportunity.raw_email || 'Not available'

  let daysLeft: string = 'unknown'
  if (opportunity.response_due) {
    const d = (new Date(opportunity.response_due).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
    daysLeft = d < 0 ? 'already past due' : d.toFixed(1) + ' days from now'
  }

  const prompt =
    'You are advising the capture team at eTel, a small-business government IT contractor, on whether to pursue a GSA eBuy opportunity. ' +
    'Assess it on three separate dimensions: FIT, VALUE and LIFT.\n\n' +
    'Company profile (the only source of truth about what eTel has done):\n' + JSON.stringify(companyProfile, null, 2) + '\n\n' +
    'Opportunity:\n' +
    'Title: ' + (opportunity.title ?? 'Unknown') + '\n' +
    'Contract vehicle: ' + (opportunity.contract_number ?? 'Unknown') + '\n' +
    'Set-aside: ' + (opportunity.set_aside_type ?? 'Unknown') + '\n' +
    'Detected NAICS: ' + (opportunity.naics_code ?? 'Unknown') + '\n' +
    'Place of performance: ' + (opportunity.place_of_performance ?? 'Unknown') + '\n' +
    'Response due: ' + (opportunity.response_due ?? 'Unknown') + ' (' + daysLeft + ')\n' +
    'Attached files: ' + (opportunity.attachments?.length ? opportunity.attachments.join('; ') : 'none listed') + '\n' +
    'Posted description / requirement text: ' + requirementText + '\n\n' +
    documentsSection +
    'Eligibility (vehicle, NAICS, facility clearance) is checked elsewhere; do not re-check it.\n\n' +
    'FIT (0-100): how well the actual WORK described matches what eTel has demonstrably done. NAICS or keyword overlap is not fit. ' +
    'Judge the work itself: a "cybersecurity" requirement that is really red/blue team operations or network/firewall engineering is a weak fit for a firm whose experience is program management, IAM, GRC and assessment support. ' +
    'Highlight work that matches eTel past performance (IRS IAM/eA3, webMethods/EAIB middleware, cybersecurity PMO, ServiceNow, data encryption, platform engineering) and call out specific technologies, mission environments or skills that eTel has NOT demonstrated. ' +
    'List those uncovered items in "gaps" (short phrases, each with how it could be mitigated if obvious, such as teaming or hiring). ' +
    'If the text is too thin to judge, say so and keep the score modest instead of inventing confidence. Use the knownGapsAndNoGos list in the profile if present.\n\n' +
    'VALUE: estimated total contract value over the full period of performance, in US dollars. ' +
    'If the text states a ceiling, budget, price or hours, use it and set basis to "stated". ' +
    'Otherwise, estimate from the scope: infer a range of labor hours or FTEs, multiply by about $' + ASSUMED_BLENDED_RATE + '/hour (' + HOURS_PER_FTE_YEAR + ' hours per FTE-year), ' +
    'and set basis to "estimated". If the scope is too vague to estimate responsibly, use null for low and high and basis "unknown". ' +
    'The note must state the assumption in one sentence (for example "about 10 FTEs for 3 years").\n\n' +
    'LIFT: how heavy the bid effort looks. Use the due date, the number of volumes (technical, management, past performance, business), page limits, key personnel counts, ' +
    'and whether this is only an RFI, market research or draft RFP (which needs a lighter response). Facts not present in the text must not be invented; say what is unknown. ' +
    'level is "low", "moderate", "high" or "unknown".\n\n' +
    'Submit your assessment by calling the submit_assessment tool.'

  // Patient mode (set by backfill/sync scripts) waits out rate limits.
  // Default mode (webhook on Vercel) gives up quickly to stay under serverless time limits.
  const patient = process.env.SOFT_SCORE_PATIENT === '1'
  const maxAttempts = patient ? 5 : 2
  const maxWaitMs = patient ? 60000 : 4000

  const body = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 3000,
    tools: [
      {
        name: 'submit_assessment',
        description: 'Submit the fit, value and lift assessment for this opportunity.',
        input_schema: {
          type: 'object',
          properties: {
            fit_score: { type: 'integer', minimum: 0, maximum: 100 },
            fit_rationale: { type: 'string' },
            gaps: { type: 'array', items: { type: 'string' } },
            value: {
              type: 'object',
              properties: {
                low: { type: ['number', 'null'] },
                high: { type: ['number', 'null'] },
                basis: { type: 'string', enum: ['stated', 'estimated', 'unknown'] },
                note: { type: 'string' },
              },
              required: ['low', 'high', 'basis', 'note'],
            },
            lift: {
              type: 'object',
              properties: {
                level: { type: 'string', enum: ['low', 'moderate', 'high', 'unknown'] },
                note: { type: 'string' },
              },
              required: ['level', 'note'],
            },
          },
          required: ['fit_score', 'fit_rationale', 'gaps', 'value', 'lift'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'submit_assessment' },
    messages: [{ role: 'user', content: prompt }],
  })

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY!,
          'anthropic-version': '2023-06-01',
        },
        body,
      })

      if (!response.ok) {
        const errorText = await response.text()
        const retryable = response.status === 429 || response.status === 529 || response.status === 503
        if (retryable && attempt < maxAttempts) {
          const retryAfter = parseFloat(response.headers.get('retry-after') ?? '')
          const waitMs = !isNaN(retryAfter) ? Math.ceil(retryAfter * 1000) + 500 : 4000 * attempt
          if (waitMs > maxWaitMs) {
            console.error('Claude rate-limited; wait of ' + Math.round(waitMs / 1000) + 's exceeds limit, skipping soft score.')
            return null
          }
          console.log('  Claude ' + response.status + ', retrying in ' + Math.round(waitMs / 1000) + 's (attempt ' + attempt + '/' + maxAttempts + ')')
          await sleep(waitMs)
          continue
        }
        console.error('Claude API error (' + response.status + '):', errorText.slice(0, 300))
        return null
      }

      const data = await response.json()
      const toolBlock = data.content?.find((block: { type: string }) => block.type === 'tool_use')
      if (!toolBlock || !toolBlock.input) {
        console.error('Claude returned no assessment (stop_reason: ' + data.stop_reason + ')')
        return null
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: any = toolBlock.input

      if (typeof parsed.fit_score !== 'number' || typeof parsed.fit_rationale !== 'string') {
        console.error('Unexpected soft score shape:', JSON.stringify(parsed).slice(0, 200))
        return null
      }

      const num = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : null)
      const basis = ['stated', 'estimated', 'unknown'].includes(parsed.value?.basis) ? parsed.value.basis : 'unknown'
      const lift = ['low', 'moderate', 'high', 'unknown'].includes(parsed.lift?.level) ? parsed.lift.level : 'unknown'

      return {
        score: Math.max(0, Math.min(100, Math.round(parsed.fit_score))),
        rationale: parsed.fit_rationale,
        gaps: Array.isArray(parsed.gaps) ? parsed.gaps.filter((g: unknown) => typeof g === 'string') : [],
        valueLow: num(parsed.value?.low),
        valueHigh: num(parsed.value?.high),
        valueBasis: basis,
        valueNote: typeof parsed.value?.note === 'string' ? parsed.value.note : null,
        liftLevel: lift,
        liftNotes: typeof parsed.lift?.note === 'string' ? parsed.lift.note : null,
      }
    } catch (err) {
      console.error('Soft score error:', err)
      return null
    }
  }

  return null
}
