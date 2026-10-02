import { supabaseAdmin } from '@/lib/supabase-server'
import OpportunityWorkspace from '@/app/components/OpportunityWorkspace'

const VERDICT_PRIORITY: Record<string, number> = { pursue: 0, review: 1, pass: 3 }

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ contract?: string; filter?: string; verdict?: string; sort?: string }>
}) {
  const params = await searchParams

  let query = supabaseAdmin.from('opportunities').select('*')
  if (params.contract) query = query.eq('contract_number', params.contract)
  if (params.filter === 'unreviewed') query = query.eq('reviewed', false)

  const { data: opportunities, error } = await query

  if (error) {
    return <div className="p-8 text-due">Error loading opportunities: {error.message}</div>
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

  const counts = { pursue: 0, review: 0, pass: 0 }
  enriched.forEach(({ verdict }) => {
    if (verdict?.verdict === 'pursue') counts.pursue++
    else if (verdict?.verdict === 'review') counts.review++
    else if (verdict?.verdict === 'pass') counts.pass++
  })

  if (params.verdict) {
    enriched = enriched.filter(({ verdict }) => verdict?.verdict === params.verdict)
  }

  const sortMode = params.sort ?? 'priority'
  enriched.sort((a, b) => {
    if (sortMode === 'fit') return (b.verdict?.soft_score ?? -1) - (a.verdict?.soft_score ?? -1)
    if (sortMode === 'due') {
      if (!a.opp.response_due) return 1
      if (!b.opp.response_due) return -1
      return new Date(a.opp.response_due).getTime() - new Date(b.opp.response_due).getTime()
    }
    const aPriority = VERDICT_PRIORITY[a.verdict?.verdict] ?? 2
    const bPriority = VERDICT_PRIORITY[b.verdict?.verdict] ?? 2
    if (aPriority !== bPriority) return aPriority - bPriority
    if (!a.opp.response_due) return 1
    if (!b.opp.response_due) return -1
    return new Date(a.opp.response_due).getTime() - new Date(b.opp.response_due).getTime()
  })

  const { data: allContracts } = await supabaseAdmin.from('opportunities').select('contract_number')
  const contractOptions = Array.from(new Set(allContracts?.map((o) => o.contract_number).filter(Boolean)))

  function buildHref(overrides: Record<string, string | undefined>) {
    const next = { ...params, ...overrides }
    const qs = Object.entries(next)
      .filter(([, v]) => v)
      .map(([k, v]) => k + '=' + encodeURIComponent(v as string))
      .join('&')
    return '/' + (qs ? '?' + qs : '')
  }

  function textToggle(active: boolean) {
    return active ? 'text-ink font-semibold underline' : 'text-ink/50 hover:text-ink'
  }

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b border-line px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="font-mono text-lg font-semibold">eBuy Opportunities</h1>
          <p className="text-xs text-ink/50 mt-0.5">{today}</p>
        </div>
        <div className="text-right">
          <div className="font-mono text-xl font-semibold">{opportunities?.length ?? 0}</div>
          <div className="text-xs text-ink/50">tracked</div>
        </div>
      </header>

      <div className="flex font-mono text-sm border-b border-line shrink-0">
        <a href={buildHref({ verdict: 'pursue' })} className="flex-1 py-2.5 text-center hover:bg-pursue-bg transition-colors">
          <span className="text-pursue font-semibold">{counts.pursue}</span>
          <span className="text-ink/50"> pursue</span>
        </a>
        <a href={buildHref({ verdict: 'review' })} className="flex-1 py-2.5 text-center border-l border-line hover:bg-review-bg transition-colors">
          <span className="text-review font-semibold">{counts.review}</span>
          <span className="text-ink/50"> review</span>
        </a>
        <a href={buildHref({ verdict: 'pass' })} className="flex-1 py-2.5 text-center border-l border-line hover:bg-pass-bg transition-colors">
          <span className="text-pass font-semibold">{counts.pass}</span>
          <span className="text-ink/50"> pass</span>
        </a>
        <a href={buildHref({ verdict: undefined })} className="flex-1 py-2.5 text-center border-l border-line hover:bg-ink/5 transition-colors">
          <span className="font-semibold">{enriched.length}</span>
          <span className="text-ink/50"> all</span>
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm px-6 py-2.5 border-b border-line shrink-0">
        <a href={buildHref({ filter: undefined, contract: undefined, verdict: undefined })} className={textToggle(!params.contract && !params.filter && !params.verdict)}>
          all
        </a>
        <a href={buildHref({ filter: 'unreviewed' })} className={textToggle(params.filter === 'unreviewed')}>
          unreviewed
        </a>
        {contractOptions.map((c) => (
          <a key={c} href={buildHref({ contract: c as string })} className={'font-mono ' + textToggle(params.contract === c)}>
            {c}
          </a>
        ))}
        <span className="ml-auto flex gap-x-3 text-ink/40">
          <span>sort:</span>
          <a href={buildHref({ sort: 'priority' })} className={textToggle(sortMode === 'priority')}>priority</a>
          <a href={buildHref({ sort: 'due' })} className={textToggle(sortMode === 'due')}>due</a>
          <a href={buildHref({ sort: 'fit' })} className={textToggle(sortMode === 'fit')}>fit</a>
        </span>
      </div>

      <OpportunityWorkspace enriched={enriched} />
    </div>
  )
}