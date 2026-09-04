import { supabaseAdmin } from './supabase-server'

export interface SoftScoreResult {
  score: number
  rationale: string
}

export async function computeSoftScore(opportunity: {
  title: string | null
  raw_email: string | null
  contract_number: string | null
}): Promise<SoftScoreResult | null> {
  const { data: pastPerformance } = await supabaseAdmin.from('past_performance').select('*')
  const { data: certifications } = await supabaseAdmin.from('certifications').select('*')
  const { data: vehicles } = await supabaseAdmin.from('vehicles').select('*')

  const companyProfile = {
    vehicles: vehicles?.map((v) => v.name),
    certifications: certifications?.map((c) => c.cert_type),
    pastPerformance: pastPerformance?.map((p) => ({
      name: p.contract_name,
      agency: p.agency,
      value: p.contract_value,
      summary: p.summary,
    })),
  }

  const prompt =
    'You are helping a government contractor decide whether to pursue a GSA eBuy opportunity.\n\n' +
    'Company profile:\n' + JSON.stringify(companyProfile, null, 2) + '\n\n' +
    'Opportunity:\n' +
    'Title: ' + (opportunity.title ?? 'Unknown') + '\n' +
    'Contract vehicle: ' + (opportunity.contract_number ?? 'Unknown') + '\n' +
    'Raw notice text: ' + (opportunity.raw_email ?? 'Not available') + '\n\n' +
    'This opportunity has already passed or is pending hard eligibility checks (vehicle/NAICS match). ' +
    'Your job is NOT to re-check eligibility. Your job is to assess FIT: how well this aligns with the ' +
    "company's past performance, domain experience, and demonstrated capacity, based only on the profile above. " +
    'If the notice text lacks enough detail to assess fit meaningfully (which is common with eBuy consolidated ' +
    'notices — they often only contain a request ID, status, and partial title), say so honestly in the rationale ' +
    'rather than inventing confidence you don\'t have.\n\n' +
    'Respond with ONLY valid JSON, no markdown formatting, no code fences, no preamble:\n' +
    '{"score": <integer 0-100>, "rationale": "<2-3 sentence explanation>"}'

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) {
      console.error('Claude API error:', await response.text())
      return null
    }

    const data = await response.json()
    const textBlock = data.content.find((block: { type: string }) => block.type === 'text')
    if (!textBlock) return null

    const cleaned = textBlock.text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)

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