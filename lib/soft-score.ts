import { supabaseAdmin } from './supabase-server'

export interface SoftScoreResult {
  score: number
  rationale: string
}

const CLAUDE_MODEL = 'claude-sonnet-5'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function computeSoftScore(opportunity: {
  title: string | null
  raw_email: string | null
  contract_number: string | null
  full_description?: string | null
}): Promise<SoftScoreResult | null> {
  const { data: pastPerformance } = await supabaseAdmin.from('past_performance').select('*')
  const { data: certifications } = await supabaseAdmin.from('certifications').select('*')
  const { data: vehicles } = await supabaseAdmin.from('vehicles').select('*')
  const { data: naicsCodes } = await supabaseAdmin.from('naics_codes').select('*')

  const companyProfile = {
    vehicles: vehicles?.map((v) => v.name + (v.awarded === false ? ' (pending award)' : '')),
    certifications: certifications?.map((c) => c.cert_type),
    naicsCodes: naicsCodes?.map((n) => n.code + (n.notes ? ' - ' + n.notes : '')),
    pastPerformance: pastPerformance?.map((p) => ({
      name: p.contract_name,
      agency: p.agency,
      value: p.contract_value,
      summary: p.summary,
    })),
  }

  const requirementText = opportunity.full_description || opportunity.raw_email || 'Not available'

  const prompt =
    'You are helping a government contractor decide whether to pursue a GSA eBuy opportunity.\n\n' +
    'Company profile:\n' + JSON.stringify(companyProfile, null, 2) + '\n\n' +
    'Opportunity:\n' +
    'Title: ' + (opportunity.title ?? 'Unknown') + '\n' +
    'Contract vehicle: ' + (opportunity.contract_number ?? 'Unknown') + '\n' +
    'Full requirement text: ' + requirementText + '\n\n' +
    'This opportunity has already passed or is pending hard eligibility checks (vehicle match, NAICS, facility clearance). ' +
    'Your job is NOT to re-check eligibility. Your job is to assess FIT: how well this aligns with the ' +
    "company's past performance, domain experience, and demonstrated capacity, based only on the profile above. " +
    'Also flag, in one sentence, any specific capability, certification, or requirement mentioned in the requirement text ' +
    'that the company profile does not clearly cover (beyond facility clearance and NAICS, which are checked separately). ' +
    "If the requirement text lacks enough detail to assess fit meaningfully, say so honestly rather than inventing confidence you don't have.\n\n" +
    'Respond with ONLY valid JSON matching this exact shape, no markdown formatting, no code fences, no preamble:\n' +
    '{"score": <integer 0-100>, "rationale": "<2-4 sentence explanation>"}\n\n' +
    'Critical: the rationale value must be valid inside a JSON string. Do not include literal line breaks, ' +
    'unescaped quotation marks, or unescaped backslashes inside the rationale text. Write it as a single plain sentence flow.'

  // Patient mode (set by backfill/sync scripts) waits out rate limits.
  // Default mode (webhook on Vercel) gives up quickly to stay under serverless time limits.
  const patient = process.env.SOFT_SCORE_PATIENT === '1'
  const maxAttempts = patient ? 5 : 2
  const maxWaitMs = patient ? 60000 : 4000

  const body = JSON.stringify({
    model: CLAUDE_MODEL,
    max_tokens: 800,
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
      const textBlock = data.content?.find((block: { type: string }) => block.type === 'text')
      if (!textBlock) {
        console.error('Claude returned no text block')
        return null
      }

      let cleaned: string = textBlock.text.replace(/```json|```/g, '').trim()
      const firstBrace = cleaned.indexOf('{')
      const lastBrace = cleaned.lastIndexOf('}')
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1)
      }

      let parsed: { score: number; rationale: string }
      try {
        parsed = JSON.parse(cleaned)
      } catch {
        const scoreMatch = cleaned.match(/"score"\s*:\s*(\d+)/)
        const rationaleMatch = cleaned.match(/"rationale"\s*:\s*"([\s\S]*?)"\s*}?\s*$/)
        if (!scoreMatch || !rationaleMatch) {
          console.error('Could not recover soft score from malformed JSON:', cleaned.slice(0, 200))
          return null
        }
        parsed = {
          score: parseInt(scoreMatch[1], 10),
          rationale: rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' '),
        }
      }

      if (typeof parsed.score !== 'number' || typeof parsed.rationale !== 'string') {
        console.error('Unexpected soft score shape:', parsed)
        return null
      }

      return { score: parsed.score, rationale: parsed.rationale }
    } catch (err) {
      console.error('Soft score error:', err)
      return null
    }
  }

  return null
}