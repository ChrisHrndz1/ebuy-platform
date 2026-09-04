'use server'

import { supabaseAdmin } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function toggleReviewed(formData: FormData) {
  const id = formData.get('id') as string
  const current = formData.get('current') === 'true'

  await supabaseAdmin
    .from('opportunities')
    .update({ reviewed: !current })
    .eq('id', id)

  revalidatePath('/')
}