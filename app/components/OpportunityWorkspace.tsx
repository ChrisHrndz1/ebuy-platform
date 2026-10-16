'use client'

import { useState, useEffect } from 'react'
import { toggleReviewed } from '@/app/actions'

interface Opportunity {
  id: string
  rfq_number: string
  title: string | null
  contract_number: string | null
  category: string | null
  status: string | null
  response_due: string | null
  reviewed: boolean
  full_description: string | null
  attachments: string[] | null
  facility_clearance_required: boolean | null
  naics_code: string | null
  set_aside_type: string | null
  place_of_performance: string | null
}

interface Verdict {
  verdict: string
  rationale: string
  soft_score: number | null
  hard_gate_results: { gate: string; passed: boolean | null; detail: string }[]
}

interface Props {
  enriched: { opp: Opportunity; verdict: Verdict | null }[]
}

function getDueInfo(dueDate: string | null) {
  if (!dueDate) return { label: 'No due date', urgent: false, past: false }
  const hoursLeft = (new Date(dueDate).getTime() - Date.now()) / (1000 * 60 * 60)
  if (hoursLeft < 0) return { label: 'Past due', urgent: false, past: true }
  if (hoursLeft < 24) return { label: 'Due today', urgent: true, past: false }
  if (hoursLeft < 72) return { label: 'Due in ' + Math.ceil(hoursLeft / 24) + 'd', urgent: true, past: false }
  return { label: 'Due in ' + Math.ceil(hoursLeft / 24) + 'd', urgent: false, past: false }
}

const VERDICT_DOT: Record<string, string> = {
  pursue: 'bg-pursue',
  review: 'bg-review',
  pass: 'bg-pass',
}

function ShieldIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M10 2L3 5v5c0 4.5 3 7.5 7 8 4-.5 7-3.5 7-8V5l-7-3z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PaperclipIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className}>
      <path
        d="M14.5 7.5l-6 6a2.5 2.5 0 01-3.5-3.5l6.5-6.5a4 4 0 015.5 5.5l-6.5 6.5a1.5 1.5 0 01-2-2l5.5-5.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function OpportunityWorkspace({ enriched }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(enriched[0]?.opp.id ?? null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false)

  useEffect(() => {
    if (!enriched.find((e) => e.opp.id === selectedId)) {
      setSelectedId(enriched[0]?.opp.id ?? null)
    }
  }, [enriched, selectedId])

  const selected = enriched.find((e) => e.opp.id === selectedId) ?? null

  return (
    <div className="flex-1 grid md:grid-cols-[380px_1fr] overflow-hidden">
      {/* Master list */}
      <div className={'border-r border-line overflow-y-auto ' + (mobileDetailOpen ? 'hidden md:block' : 'block')}>
        {enriched.map(({ opp, verdict }) => {
          const due = getDueInfo(opp.response_due)
          const attachmentCount = Array.isArray(opp.attachments) ? opp.attachments.length : 0
          const isSelected = opp.id === selectedId
          return (
            <button
              key={opp.id}
              onClick={() => {
                setSelectedId(opp.id)
                setMobileDetailOpen(true)
              }}
              className={
                'w-full text-left px-4 py-3 border-b border-line flex gap-3 items-start transition-colors ' +
                (isSelected ? 'bg-ink/[0.04]' : 'hover:bg-ink/[0.02]') +
                (opp.reviewed ? ' opacity-50' : '')
              }
            >
              <span className={'mt-1.5 w-2 h-2 rounded-full shrink-0 ' + (VERDICT_DOT[verdict?.verdict ?? ''] ?? 'bg-line')} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-ink/50">{opp.rfq_number}</span>
                  <span className={'text-xs shrink-0 ' + (due.urgent ? 'text-due font-medium' : 'text-ink/40')}>
                    {due.label}
                  </span>
                </div>
                <div className="text-sm font-medium truncate mt-0.5">{opp.title}</div>
                <div className="flex items-center gap-3 mt-1 text-xs text-ink/40">
                  <span className="font-mono">{opp.contract_number ?? 'unknown'}</span>
                  {opp.facility_clearance_required && (
                    <span className="flex items-center gap-1 text-review">
                      <ShieldIcon className="w-3 h-3" /> clearance
                    </span>
                  )}
                  {attachmentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <PaperclipIcon className="w-3 h-3" /> {attachmentCount}
                    </span>
                  )}
                </div>
              </div>
            </button>
          )
        })}
        {enriched.length === 0 && (
          <div className="text-ink/40 text-sm py-12 text-center px-4">No opportunities match this filter.</div>
        )}
      </div>

      {/* Detail panel */}
      <div className={'overflow-y-auto bg-paper ' + (mobileDetailOpen ? 'block' : 'hidden md:block')}>
        {selected ? (
          <DetailPanel key={selected.opp.id} opp={selected.opp} verdict={selected.verdict} onBack={() => setMobileDetailOpen(false)} />
        ) : (
          <div className="h-full flex items-center justify-center text-ink/30 text-sm">Select an opportunity</div>
        )}
      </div>
    </div>
  )
}

function DetailPanel({ opp, verdict, onBack }: { opp: Opportunity; verdict: Verdict | null; onBack: () => void }) {
  const due = getDueInfo(opp.response_due)
  const verdictColor =
    verdict?.verdict === 'pursue' ? 'text-pursue bg-pursue-bg'
    : verdict?.verdict === 'review' ? 'text-review bg-review-bg'
    : verdict?.verdict === 'pass' ? 'text-pass bg-pass-bg'
    : 'text-ink/40 bg-ink/5'

  return (
    <div className="max-w-2xl mx-auto p-6 md:p-10">
      <button onClick={onBack} className="md:hidden text-sm text-ink/50 mb-4">&larr; Back to list</button>

      <div className="bg-white rounded-lg shadow-sm border border-line p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-ink/50">{opp.rfq_number}</div>
            <h2 className="text-lg font-semibold mt-1">{opp.title}</h2>
            <div className="font-mono text-xs text-ink/40 mt-1">{opp.contract_number ?? 'contract unknown'}{opp.category ? ' · ' + opp.category : ''}</div>
          </div>
          {verdict && (
            <span className={'text-xs px-2 py-1 rounded-full font-semibold shrink-0 ' + verdictColor}>
              {verdict.verdict.toUpperCase()}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-2 mt-4">
          <span className={'text-xs px-2 py-1 rounded-full ' + (due.urgent ? 'bg-due-bg text-due' : 'bg-ink/5 text-ink/60')}>
            {due.label}
          </span>
          {opp.status && <span className="text-xs px-2 py-1 rounded-full bg-ink/5 text-ink/60">{opp.status}</span>}
          {verdict?.soft_score !== null && verdict?.soft_score !== undefined && (
            <span className="text-xs px-2 py-1 rounded-full bg-ink/5 text-ink/60">fit {verdict.soft_score}/100</span>
          )}
          {opp.facility_clearance_required && (
            <span className="text-xs px-2 py-1 rounded-full bg-review-bg text-review flex items-center gap-1">
              <ShieldIcon className="w-3 h-3" /> facility clearance required
            </span>
          )}
        </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-sm">
          {opp.set_aside_type && (
            <div>
              <div className="text-xs text-ink/40">Set-aside</div>
              <div>{opp.set_aside_type}</div>
            </div>
          )}
          {opp.naics_code && (
            <div>
              <div className="text-xs text-ink/40">NAICS (detected)</div>
              <div className="font-mono">{opp.naics_code}</div>
            </div>
          )}
          {opp.place_of_performance && (
            <div className="col-span-2">
              <div className="text-xs text-ink/40">Place of performance</div>
              <div>{opp.place_of_performance}</div>
            </div>
          )}
        </div>

        <form action={toggleReviewed} className="mt-4">
          <input type="hidden" name="id" value={opp.id} />
          <input type="hidden" name="current" value={String(opp.reviewed)} />
          <button type="submit" className="text-xs underline text-ink/50 hover:text-ink">
            {opp.reviewed ? 'Mark unreviewed' : 'Mark reviewed'}
          </button>
        </form>
      </div>

      {verdict && (
        <div className="mt-4 bg-white rounded-lg shadow-sm border border-line p-6">
          <h3 className="text-sm font-semibold text-ink/70 mb-3">Qualification</h3>
          <ul className="space-y-1.5 mb-3">
            {verdict.hard_gate_results?.map((g, i) => (
              <li key={i} className="font-mono text-xs text-ink/70 flex gap-2">
                <span>{g.passed === true ? '✅' : g.passed === false ? '❌' : '❓'}</span>
                <span>{g.gate}: {g.detail}</span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-ink/80 leading-relaxed">{verdict.rationale}</p>
        </div>
      )}

      {opp.attachments && opp.attachments.length > 0 && (
        <div className="mt-4 bg-white rounded-lg shadow-sm border border-line p-6">
          <h3 className="text-sm font-semibold text-ink/70 mb-3 flex items-center gap-2">
            <PaperclipIcon className="w-4 h-4" /> Attachments ({opp.attachments.length})
          </h3>
          <ul className="space-y-1">
            {opp.attachments.map((a, i) => (
              <li key={i} className="text-sm text-ink/70 font-mono text-xs">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {opp.full_description && (
        <div className="mt-4 bg-white rounded-lg shadow-sm border border-line p-6">
          <h3 className="text-sm font-semibold text-ink/70 mb-3">Description</h3>
          <p className="text-sm text-ink/80 whitespace-pre-line leading-relaxed">{opp.full_description}</p>
        </div>
      )}
    </div>
  )
}