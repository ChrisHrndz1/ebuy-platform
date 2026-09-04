import { supabaseAdmin } from './supabase-server'

export interface GateResult {
  gate: string
  passed: boolean | null // null = insufficient data to judge
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
}): Promise<QualificationResult> {
  const gates: GateResult[] = []

  // Gate 1: Vehicle match
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

  // Gate 2: NAICS match
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

  // Roll gates up into a single verdict
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

export async function saveVerdict(opportunityId: string, result: QualificationResult) {
  await supabaseAdmin.from('verdicts').insert({
    opportunity_id: opportunityId,
    verdict: result.verdict,
    hard_gate_results: result.hardGateResults,
    rationale: result.rationale,
    engine_version: 'hard-gates-v1',
  })
}