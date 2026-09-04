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
  dueBadge: { label: string; color: string }
}

export default function OpportunityCard({ opp, verdict, dueBadge }: Props) {
  const [expanded, setExpanded] = useState(false)

  const cardClass = 'border rounded-lg p-4' + (opp.reviewed ? ' opacity-50' : '')
  const badgeClass = 'text-xs px-2 py-1 rounded-full ' + dueBadge.color
  const verdictClass = verdict?.verdict === 'pursue' ? 'bg-green-100 text-green-800'
    : verdict?.verdict === 'review' ? 'bg-orange-100 text-orange-800'
    : verdict?.verdict === 'pass' ? 'bg-gray-200 text-gray-600'
    : 'bg-gray-100 text-gray-400'

  return (
    <div className={cardClass}>
      <div className="flex justify-between items-start">
        <div>
          <div className="font-mono text-sm text-gray-500">{opp.rfq_number}</div>
          <div className="font-medium">{opp.title}</div>
          <div className="text-sm text-gray-500 mt-1">
            Contract: {opp.contract_number ?? 'Unknown'}
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-2">
          {verdict && (
            <span className={'text-xs px-2 py-1 rounded-full font-semibold ' + verdictClass}>
              {verdict.verdict.toUpperCase()}
            </span>
          )}
          {verdict?.soft_score !== null && verdict?.soft_score !== undefined && (
            <span className="text-xs text-gray-500">Fit: {verdict.soft_score}/100</span>
          )}
          <span className="text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-800">
            {opp.status ?? 'Unknown'}
          </span>
          <span className={badgeClass}>{dueBadge.label}</span>
          <form action={toggleReviewed}>
            <input type="hidden" name="id" value={opp.id} />
            <input type="hidden" name="current" value={String(opp.reviewed)} />
            <button type="submit" className="text-xs underline text-gray-500">
              {opp.reviewed ? 'Mark unreviewed' : 'Mark reviewed'}
            </button>
          </form>
        </div>
      </div>

      {verdict && (
        <div className="mt-3 pt-3 border-t">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-blue-600 underline"
          >
            {expanded ? 'Hide details' : 'Why this verdict?'}
          </button>
          {expanded && (
            <div className="mt-2 text-sm text-gray-700 space-y-2">
              <div>
                <span className="font-medium">Hard gates:</span>
                <ul className="list-disc list-inside ml-2">
                  {verdict.hard_gate_results?.map((g, i) => (
                    <li key={i}>
                      {g.gate}: {g.passed === true ? '✅' : g.passed === false ? '❌' : '❓'} {g.detail}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <span className="font-medium">Full rationale:</span>
                <p className="mt-1">{verdict.rationale}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}