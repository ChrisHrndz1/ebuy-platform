'use client'

import { useState } from 'react'
import { toggleReviewed } from '@/app/actions'

interface Props {
  opp: {
    id: string
    rfq_number: string
    title: string | null
    contract_number: string | null
    status: string | null
    response_due: string | null
    reviewed: boolean
  }
  verdict: {
    verdict: string
    rationale: string
    soft_score: number | null
    hard_gate_results: { gate: string; passed: boolean | null; detail: string }[]
  } | null
  dueBadge: { label: string; urgent: boolean }
}

const VERDICT_STYLES: Record<string, { stripe: string; tagBg: string; tagText: string }> = {
  pursue: { stripe: 'border-l-pursue', tagBg: 'bg-pursue-bg', tagText: 'text-pursue' },
  review: { stripe: 'border-l-review', tagBg: 'bg-review-bg', tagText: 'text-review' },
  pass: { stripe: 'border-l-pass', tagBg: 'bg-pass-bg', tagText: 'text-pass' },
}

export default function OpportunityCard({ opp, verdict, dueBadge }: Props) {
  const [expanded, setExpanded] = useState(false)

  const style = VERDICT_STYLES[verdict?.verdict ?? ''] ?? {
    stripe: 'border-l-line',
    tagBg: 'bg-pass-bg',
    tagText: 'text-pass',
  }

  return (
    <div className={'border-b border-line border-l-4 ' + style.stripe + (opp.reviewed ? ' opacity-50' : '')}>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 p-4">
        <div className="min-w-0">
          <div className="font-mono text-xs text-ink/60">{opp.rfq_number}</div>
          <div className="font-medium mt-0.5">{opp.title}</div>
          <div className="font-mono text-xs text-ink/50 mt-1">
            {opp.contract_number ?? 'contract unknown'}
          </div>
        </div>

        <div className="flex sm:flex-col items-start sm:items-end gap-1.5 shrink-0">
          {verdict && (
            <span className={'text-xs px-1.5 py-0.5 rounded-sm font-semibold ' + style.tagBg + ' ' + style.tagText}>
              {verdict.verdict}
            </span>
          )}
          {verdict?.soft_score !== null && verdict?.soft_score !== undefined && (
            <span className="font-mono text-xs text-ink/50">fit {verdict.soft_score}/100</span>
          )}
          <span className="text-xs px-1.5 py-0.5 rounded-sm bg-ink/5 text-ink/70">
            {opp.status ?? 'unknown'}
          </span>
          <span className={'text-xs px-1.5 py-0.5 rounded-sm ' + (dueBadge.urgent ? 'bg-due-bg text-due' : 'bg-ink/5 text-ink/70')}>
            {dueBadge.label}
          </span>
          <form action={toggleReviewed}>
            <input type="hidden" name="id" value={opp.id} />
            <input type="hidden" name="current" value={String(opp.reviewed)} />
            <button type="submit" className="text-xs underline text-ink/50 hover:text-ink">
              {opp.reviewed ? 'mark unreviewed' : 'mark reviewed'}
            </button>
          </form>
        </div>
      </div>

      {verdict && (
        <div className="px-4 pb-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs underline text-ink/60 hover:text-ink"
          >
            {expanded ? 'hide details' : 'why this verdict'}
          </button>
          <div
            className={'overflow-hidden transition-all duration-200 ' + (expanded ? 'max-h-96 mt-2' : 'max-h-0')}
          >
            <div className="text-sm space-y-2 pb-1">
              <ul className="space-y-1">
                {verdict.hard_gate_results?.map((g, i) => (
                  <li key={i} className="font-mono text-xs text-ink/70">
                    {g.passed === true ? '[pass]' : g.passed === false ? '[fail]' : '[?]'} {g.gate}: {g.detail}
                  </li>
                ))}
              </ul>
              <p className="text-ink/80">{verdict.rationale}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}