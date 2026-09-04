import { supabaseAdmin } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import { parseEbuyRequests, parseEbuyDate, parseContractNumber } from '@/lib/parse-ebuy-email'
import { evaluateHardGates, saveVerdict } from '@/lib/qualification-engine'

export async function POST(request: Request) {
  const payload = await request.json()

  const contractNumber = parseContractNumber(payload.Subject ?? '')
  const requests = parseEbuyRequests(payload.HtmlBody ?? '')

  if (requests.length === 0) {
    console.log('No parseable requests found in this email:', payload.Subject)
    return NextResponse.json({ received: true, parsed: 0 })
  }

  for (const req of requests) {
    const { data, error } = await supabaseAdmin
      .from('opportunities')
      .upsert(
        {
          rfq_number: req.requestId,
          title: req.title,
          status: req.status,
          contract_number: contractNumber,
          response_due: parseEbuyDate(req.dueBy),
          raw_email: payload.TextBody ?? null,
          parsed_fields: payload,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'rfq_number' }
      )
      .select()
      .single()

    if (error) {
      console.error('Insert error for ' + req.requestId + ':', error.message)
      continue
    }

    const result = await evaluateHardGates(data)
    await saveVerdict(data.id, result)
  }

  return NextResponse.json({ received: true, parsed: requests.length })
}