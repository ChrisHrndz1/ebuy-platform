import { supabaseAdmin } from './supabase-server'
import { computeSoftScore } from './soft-score'

export interface GateResult {
  gate: string
  passed: boolean | null
  detail: string
}

export interface QualificationResult {
  verdict: 'pursue' | 'review' | 'pass'
  hardGateResults: GateResult[]
  rationale: string
}

export async function evaluateHardGates(opportunity: {
  contract_number: string | null
  naics_code: string | null
  facility_clearance_required?: boolean | null
}): Promise<QualificationResult> {
  const gates: GateResult[] = []

  let vehicleGate: GateResult
  if (!opportunity.contract_number) {
    vehicleGate = {
      gate: 'vehicle_match',
      passed: null,
      detail: 'No contract number found on this opportunity — cannot verify vehicle match.',
    }
  } else {
    const { data: matchingVehicles } = await supabaseAdmin
      .from('vehicles')
      .select('*')
      .eq('contract_number', opportunity.contract_number)
      .eq('awarded', true)

    if (matchingVehicles && matchingVehicles.length > 0) {
      vehicleGate = {
        gate: 'vehicle_match',
        passed: true,
        detail: 'Matches held vehicle: ' + matchingVehicles.map((v) => v.name).join(', '),
      }
    } else {
      vehicleGate = {
        gate: 'vehicle_match',
        passed: false,
        detail: 'Contract number ' + opportunity.contract_number + ' does not match any vehicle on file.',
      }
    }
  }
  gates.push(vehicleGate)

  let naicsGate: GateResult
  if (!opportunity.naics_code) {
    naicsGate = {
      gate: 'naics_match',
      passed: null,
      detail: 'No NAICS code available from this opportunity source — requires manual review.',
    }
  } else {
    const { data: matchingNaics } = await supabaseAdmin
      .from('naics_codes')
      .select('*')
      .eq('code', opportunity.naics_code)

    const found = matchingNaics && matchingNaics.length > 0
    naicsGate = {
      gate: 'naics_match',
      passed: found,
      detail: found
        ? 'Matches registered NAICS code ' + opportunity.naics_code
        : 'NAICS code ' + opportunity.naics_code + ' is not among registered codes.',
    }
  }
  gates.push(naicsGate)

  let clearanceGate: GateResult
  if (opportunity.facility_clearance_required === null || opportunity.facility_clearance_required === undefined) {
    clearanceGate = {
      gate: 'facility_clearance',
      passed: null,
      detail: 'Could not determine facility clearance requirement from available documents — requires manual review.',
    }
  } else if (opportunity.facility_clearance_required === true) {
    clearanceGate = {
      gate: 'facility_clearance',
      passed: null,
      detail: 'This opportunity requires a facility clearance (DD254 or clearance language detected) — verify company facility clearance status before proceeding.',
    }
  } else {
    clearanceGate = {
      gate: 'facility_clearance',
      passed: true,
      detail: 'No facility clearance requirement detected.',
    }
  }
  gates.push(clearanceGate)

  const anyFailed = gates.some((g) => g.passed === false)
  const anyUnknown = gates.some((g) => g.passed === null)

  let verdict: 'pursue' | 'review' | 'pass'
  let rationale: string

  if (anyFailed) {
    verdict = 'pass'
    rationale = 'Hard gate failed: ' + gates.filter((g) => g.passed === false).map((g) => g.detail).join(' ')
  } else if (anyUnknown) {
    verdict = 'review'
    rationale = 'Cannot fully confirm eligibility: ' + gates.filter((g) => g.passed === null).map((g) => g.detail).join(' ')
  } else {
    verdict = 'pursue'
    rationale = 'All hard gates passed: ' + gates.map((g) => g.detail).join(' ')
  }

  return { verdict, hardGateResults: gates, rationale }
}

export async function saveVerdict(
  opportunityId: string,
  result: QualificationResult,
  opportunity: {
    title: string | null
    raw_email: string | null
    contract_number: string | null
    full_description?: string | null
    response_due?: string | null
    naics_code?: string | null
    set_aside_type?: string | null
    place_of_performance?: string | null
    attachments?: string[] | null
  }
) {
  let softScore: number | null = null
  let soft: Awaited<ReturnType<typeof computeSoftScore>> = null
  let combinedRationale = result.rationale

  if (result.verdict !== 'pass') {
    soft = await computeSoftScore({ ...opportunity, id: opportunityId })
    if (soft) {
      softScore = soft.score
      combinedRationale = result.rationale + ' | Fit assessment: ' + soft.rationale
    }
  }

  await supabaseAdmin.from('verdicts').insert({
    opportunity_id: opportunityId,
    verdict: result.verdict,
    hard_gate_results: result.hardGateResults,
    soft_score: softScore,
    rationale: combinedRationale,
    value_low: soft?.valueLow ?? null,
    value_high: soft?.valueHigh ?? null,
    value_basis: soft?.valueBasis ?? null,
    value_note: soft?.valueNote ?? null,
    lift_level: soft?.liftLevel ?? null,
    lift_notes: soft?.liftNotes ?? null,
    fit_gaps: soft?.gaps ?? null,
    engine_version: 'hard-gates-v2+facility-clearance+fit-value-lift-v1',
  })
}