import { supabaseAdmin } from '@/lib/supabase-server'
import { toggleReviewed } from '@/app/actions'

function getDueBadge(dueDate: string | null) {
  if (!dueDate) return { label: 'No due date', color: 'bg-gray-100 text-gray-600' }

  const now = new Date()
  const due = new Date(dueDate)
  const hoursLeft = (due.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (hoursLeft < 0) return { label: 'Past due', color: 'bg-gray-200 text-gray-500' }
  if (hoursLeft < 24) return { label: 'Due today', color: 'bg-red-100 text-red-800' }
  if (hoursLeft < 72) return { label: 'Due in ' + Math.ceil(hoursLeft / 24) + 'd', color: 'bg-orange-100 text-orange-800' }
  return { label: 'Due in ' + Math.ceil(hoursLeft / 24) + 'd', color: 'bg-green-100 text-green-800' }
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string; filter?: string }>
}) {
  const params = await searchParams

  let query = supabaseAdmin
    .from('opportunities')
    .select('*')
    .order('response_due', { ascending: true, nullsFirst: false })

  if (params.contract) {
    query = query.eq('contract_number', params.contract)
  }
  if (params.filter === 'unreviewed') {
    query = query.eq('reviewed', false)
  }

  const { data: opportunities, error } = await query

  if (error) {
    return <div className="p-8 text-red-600">Error loading opportunities: {error.message}</div>
  }

  const { data: verdictsData } = await supabaseAdmin
    .from('verdicts')
    .select('*')
    .order('created_at', { ascending: false })

  const latestVerdictByOpportunity = new Map()
  verdictsData?.forEach((v) => {
    if (!latestVerdictByOpportunity.has(v.opportunity_id)) {
      latestVerdictByOpportunity.set(v.opportunity_id, v)
    }
  })

  const { data: allContracts } = await supabaseAdmin
    .from('opportunities')
    .select('contract_number')

  const contractOptions = Array.from(
    new Set(allContracts?.map((o) => o.contract_number).filter(Boolean))
  )

  const allPillClass = 'px-3 py-1 rounded-full border ' + (!params.contract && !params.filter ? 'bg-black text-white' : 'text-gray-600')
  const unreviewedPillClass = 'px-3 py-1 rounded-full border ' + (params.filter === 'unreviewed' ? 'bg-black text-white' : 'text-gray-600')

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">eBuy Opportunities</h1>

      <div className="flex gap-2 mb-6 flex-wrap items-center text-sm">
        <a href="/" className={allPillClass}>
          All
        </a>
        <a href="/?filter=unreviewed" className={unreviewedPillClass}>
          Unreviewed
        </a>
        {contractOptions.map((c) => {
          const pillClass = 'px-3 py-1 rounded-full border ' + (params.contract === c ? 'bg-black text-white' : 'text-gray-600')
          return (
            <a key={c} href={'/?contract=' + c} className={pillClass}>
              {c}
            </a>
          )
        })}
      </div>

      <div className="space-y-3">
        {opportunities?.map((opp) => {
          const badge = getDueBadge(opp.response_due)
          const cardClass = 'border rounded-lg p-4 flex justify-between items-start' + (opp.reviewed ? ' opacity-50' : '')
          const badgeClass = 'text-xs px-2 py-1 rounded-full ' + badge.color

          const verdict = latestVerdictByOpportunity.get(opp.id)
          const verdictClass = verdict?.verdict === 'pursue' ? 'bg-green-100 text-green-800'
            : verdict?.verdict === 'review' ? 'bg-orange-100 text-orange-800'
            : verdict?.verdict === 'pass' ? 'bg-gray-200 text-gray-600'
            : 'bg-gray-100 text-gray-400'

          return (
            <div key={opp.id} className={cardClass}>
              <div>
                <div className="font-mono text-sm text-gray-500">{opp.rfq_number}</div>
                <div className="font-medium">{opp.title}</div>
                <div className="text-sm text-gray-500 mt-1">
                  Contract: {opp.contract_number ?? 'Unknown'}
                </div>
              </div>
              <div className="text-right flex flex-col items-end gap-2">
                {verdict && (
                  <span
                    className={'text-xs px-2 py-1 rounded-full font-semibold ' + verdictClass}
                    title={verdict.rationale}
                  >
                    {verdict.verdict.toUpperCase()}
                  </span>
                )}
                {verdict?.soft_score !== null && verdict?.soft_score !== undefined && (
                  <span className="text-xs text-gray-500">
                    Fit: {verdict.soft_score}/100
                  </span>
                )}
                <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">
                  {opp.status ?? 'Unknown'}
                </span>
                <span className={badgeClass}>
                  {badge.label}
                </span>
                <form action={toggleReviewed}>
                  <input type="hidden" name="id" value={opp.id} />
                  <input type="hidden" name="current" value={String(opp.reviewed)} />
                  <button type="submit" className="text-xs underline text-gray-500">
                    {opp.reviewed ? 'Mark unreviewed' : 'Mark reviewed'}
                  </button>
                </form>
              </div>
            </div>
          )
        })}
        {opportunities?.length === 0 && (
          <div className="text-gray-500">No opportunities match this filter.</div>
        )}
      </div>
    </main>
  )
}