import { supabaseAdmin } from '@/lib/supabase-server'
import OpportunityCard from '@/app/components/OpportunityCard'

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

const VERDICT_PRIORITY: Record<string, number> = { pursue: 0, review: 1, pass: 3 }

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string; filter?: string; verdict?: string; sort?: string }>
}) {
  const params = await searchParams

  let query = supabaseAdmin.from('opportunities').select('*')

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

  let enriched = (opportunities ?? []).map((opp) => ({
    opp,
    verdict: latestVerdictByOpportunity.get(opp.id) ?? null,
  }))

  // Summary counts computed before verdict-filtering, so the stats bar always reflects everything
  const counts = { pursue: 0, review: 0, pass: 0, unscored: 0 }
  enriched.forEach(({ verdict }) => {
    if (!verdict) counts.unscored++
    else if (verdict.verdict === 'pursue') counts.pursue++
    else if (verdict.verdict === 'review') counts.review++
    else if (verdict.verdict === 'pass') counts.pass++
  })

  if (params.verdict) {
    enriched = enriched.filter(({ verdict }) => verdict?.verdict === params.verdict)
  }

  const sortMode = params.sort ?? 'priority'
  enriched.sort((a, b) => {
    if (sortMode === 'fit') {
      return (b.verdict?.soft_score ?? -1) - (a.verdict?.soft_score ?? -1)
    }
    if (sortMode === 'due') {
      if (!a.opp.response_due) return 1
      if (!b.opp.response_due) return -1
      return new Date(a.opp.response_due).getTime() - new Date(b.opp.response_due).getTime()
    }
    // default: priority (pursue/review first, pass last), then soonest due date within each group
    const aPriority = VERDICT_PRIORITY[a.verdict?.verdict] ?? 2
    const bPriority = VERDICT_PRIORITY[b.verdict?.verdict] ?? 2
    if (aPriority !== bPriority) return aPriority - bPriority
    if (!a.opp.response_due) return 1
    if (!b.opp.response_due) return -1
    return new Date(a.opp.response_due).getTime() - new Date(b.opp.response_due).getTime()
  })

  const { data: allContracts } = await supabaseAdmin.from('opportunities').select('contract_number')
  const contractOptions = Array.from(new Set(allContracts?.map((o) => o.contract_number).filter(Boolean)))

  function pillClass(active: boolean) {
    return 'px-3 py-1 rounded-full border text-sm ' + (active ? 'bg-black text-white' : 'text-gray-600')
  }

  function buildHref(overrides: Record<string, string | undefined>) {
    const next = { ...params, ...overrides }
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => k + '=' + encodeURIComponent(v as string))
      .join('&')
    return '/' + (qs ? '?' + qs : '')
  }

  return (
    <main className="p-8 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">eBuy Opportunities</h1>

      <div className="grid grid-cols-4 gap-3 mb-6">
        <a href={buildHref({ verdict: 'pursue' })} className="border rounded-lg p-3 text-center hover:bg-green-50">
          <div className="text-2xl font-bold text-green-700">{counts.pursue}</div>
          <div className="text-xs text-gray-500">Pursue</div>
        </a>
        <a href={buildHref({ verdict: 'review' })} className="border rounded-lg p-3 text-center hover:bg-orange-50">
          <div className="text-2xl font-bold text-orange-700">{counts.review}</div>
          <div className="text-xs text-gray-500">Review</div>
        </a>
        <a href={buildHref({ verdict: 'pass' })} className="border rounded-lg p-3 text-center hover:bg-gray-50">
          <div className="text-2xl font-bold text-gray-500">{counts.pass}</div>
          <div className="text-xs text-gray-500">Pass</div>
        </a>
        <a href={buildHref({ verdict: undefined })} className="border rounded-lg p-3 text-center hover:bg-blue-50">
          <div className="text-2xl font-bold text-blue-700">{counts.pursue + counts.review + counts.pass + counts.unscored}</div>
          <div className="text-xs text-gray-500">All</div>
        </a>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <a href={buildHref({ filter: undefined, contract: undefined, verdict: undefined })} className={pillClass(!params.contract && !params.filter && !params.verdict)}>
          All
        </a>
        <a href={buildHref({ filter: 'unreviewed' })} className={pillClass(params.filter === 'unreviewed')}>
          Unreviewed
        </a>
        {contractOptions.map((c) => (
          <a key={c} href={buildHref({ contract: c as string })} className={pillClass(params.contract === c)}>
            {c}
          </a>
        ))}
      </div>

      <div className="flex gap-2 mb-6 items-center text-sm text-gray-500">
        Sort:
        <a href={buildHref({ sort: 'priority' })} className={pillClass(sortMode === 'priority')}>Priority</a>
        <a href={buildHref({ sort: 'due' })} className={pillClass(sortMode === 'due')}>Due date</a>
        <a href={buildHref({ sort: 'fit' })} className={pillClass(sortMode === 'fit')}>Fit score</a>
      </div>

      <div className="space-y-3">
        {enriched.map(({ opp, verdict }) => (
          <OpportunityCard key={opp.id} opp={opp} verdict={verdict} dueBadge={getDueBadge(opp.response_due)} />
        ))}
        {enriched.length === 0 && (
          <div className="text-gray-500">No opportunities match this filter.</div>
        )}
      </div>
    </main>
  )
}