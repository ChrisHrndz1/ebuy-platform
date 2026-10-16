import { supabaseAdmin } from './supabase-server'

export interface SoftScoreResult {
  score: number
  rationale: string
}

const GEMINI_MODEL = 'gemini-3.8-flash'

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
    'Respond with a JSON object with two fields: "score" (integer 0-100) and "rationale" (a 2-4 sentence plain-text explanation).'

  try {
    const response = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/' + GEMINI_MODEL + ':generateContent',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GEMINI_API_KEY!,
        },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                score: { type: 'INTEGER' },
                rationale: { type: 'STRING' },
              },
              required: ['score', 'rationale'],
            },
            maxOutputTokens: 2048,
            temperature: 0.2,
          },
        }),
      }
    )

    if (!response.ok) {
      console.error('Gemini API error:', await response.text())
      return null
    }

    const data = await response.json()
    const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) {
      console.error('Gemini returned no text:', JSON.stringify(data).slice(0, 300))
      return null
    }

    const parsed = JSON.parse(text)
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