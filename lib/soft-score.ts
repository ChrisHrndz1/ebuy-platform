import { supabaseAdmin } from './supabase-server'

export interface SoftScoreResult {
  score: number
  rationale: string
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
    "that the company profile does not clearly cover (beyond facility clearance and NAICS, which are checked separately). " +
    'If the requirement text lacks enough detail to assess fit meaningfully, say so honestly rather than inventing confidence you don\'t have.\n\n' +
    'Respond with ONLY valid JSON matching this exact shape, no markdown formatting, no code fences, no preamble:\n' +
    '{"score": <integer 0-100>, "rationale": "<2-4 sentence explanation>"}\n\n' +
    'Critical: the rationale value must be valid inside a JSON string. Do not include literal line breaks, ' +
    'unescaped quotation marks, or unescaped backslashes inside the rationale text. Write it as a single plain sentence flow.'

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

    let cleaned = textBlock.text.replace(/```json|```/g, '').trim()

    // Extract just the {...} object in case there's any stray text around it
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace !== -1) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1)
    }

    let parsed: { score: number; rationale: string }
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      // Fallback: pull score and rationale out with regex if strict JSON parsing fails
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