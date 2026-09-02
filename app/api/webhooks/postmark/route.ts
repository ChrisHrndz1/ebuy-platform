import { supabaseAdmin } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'

export async function POST(request: Request) {
  const payload = await request.json()

  // Log the full raw payload for now so we can see real Postmark data
  console.log('Postmark inbound payload:', JSON.stringify(payload, null, 2))

  const { error } = await supabaseAdmin
    .from('opportunities')
    .insert({
      rfq_number: `TEMP-${Date.now()}`, // placeholder until real parsing exists
      title: payload.Subject ?? null,
      raw_email: payload.TextBody ?? payload.HtmlBody ?? null,
      parsed_fields: payload, // store everything for now
    })

  if (error) {
    console.error('Insert error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}