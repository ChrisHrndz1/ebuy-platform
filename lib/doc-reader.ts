// Pure helpers: turn a downloaded solicitation file into text and work out what kind of document it is.
// No network, no database. Files are never kept on disk by this module.

export type DocKind = 'pws' | 'instructions' | 'combined' | 'notice' | 'pricing' | 'other'

export const MAX_STORED_CHARS = 250_000

// Skipped before download. Deliberately conservative: file names vary a lot between agencies,
// so anything not clearly pricing or a form is downloaded and classified by its CONTENT instead.
const SKIP_BY_NAME = /clin|pricing|price\s*(sheet|schedule)|wage\s*determination|\bwd\b|\bppq\b|questionnaire|dd\s*-?\s*254|quote\s*form/i

export function skipReasonForName(filename: string): { skip: boolean; kind: DocKind } {
  if (/\.(pdf|docx)$/i.test(filename) === false) {
    return { skip: true, kind: /\.(xlsx?|csv)$/i.test(filename) ? 'pricing' : 'other' }
  }
  if (SKIP_BY_NAME.test(filename)) {
    return { skip: true, kind: /clin|pric|wage/i.test(filename) ? 'pricing' : 'other' }
  }
  return { skip: false, kind: 'other' }
}

export async function extractText(
  buffer: Buffer,
  filename: string
): Promise<{ text: string; pages: number | null }> {
  if (/\.pdf$/i.test(filename)) {
    const { extractText: pdfExtract, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(buffer))
    const result = await pdfExtract(pdf, { mergePages: true })
    const text = Array.isArray(result.text) ? result.text.join('\n') : result.text
    return { text: clean(text), pages: result.totalPages ?? null }
  }
  if (/\.docx$/i.test(filename)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import('mammoth')
    const mammoth = mod.default ?? mod
    const result = await mammoth.extractRawText({ buffer })
    return { text: clean(result.value), pages: null }
  }
  return { text: '', pages: null }
}

function clean(s: string): string {
  return s
    .replace(/\u0000/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_STORED_CHARS)
}

export function classifyDocument(filename: string, text: string): DocKind {
  const head = (filename + '\n' + text.slice(0, 2500)).toLowerCase()
  const body = text.toLowerCase()
  const title = (filename + '\n' + text.slice(0, 600)).toLowerCase()

  // Supporting documents that mention the PWS but are not it.
  if (/quality assurance surveillance plan|\bqasp\b/.test(title)) return 'other'
  if (/organizational conflicts? of interest|\boci\b|non-?disclosure|\bnda\b|rules of behavior|resume template/.test(title)) return 'other'

  const pwsTitle = /performance work statement|statement of work|statement of objectives|scope of work/.test(head)
  const pwsHits = (body.match(/\bpws\b|\bsow\b|\bsoo\b/g) ?? []).length
  const hasTasks = /\btask\s*(area\s*)?\d|\b\d\.\d+\s+[a-z]/.test(body)
  const isPws = pwsTitle || (pwsHits >= 8 && hasTasks)

  const instrMarkers = [
    /instructions to (offerors|quoters|vendors)/,
    /evaluation (factors|criteria)/,
    /basis (of|for) (award|evaluation)/,
    /(proposal|quote|quotation) (submission|preparation|format|instructions)/,
    /page limit|not exceed \d+ pages|font (size|type)|\d+[- ]point/,
    /\bvolume\s+(i{1,3}|iv|\d)\b/,
    /section l\b|section m\b/,
    /key personnel/,
  ]
  const instrCount = instrMarkers.filter((r) => r.test(body)).length
  const instrTitle = /instructions|evaluation (factors|criteria)|basis for award/.test(head)
  const isInstr = instrCount >= 3 || (instrTitle && instrCount >= 2)

  if (isPws && isInstr) return 'combined'
  if (isPws) return 'pws'
  if (isInstr) return 'instructions'

  // Short RFI / sources-sought / market-research notices: they state what the agency is actually asking for.
  if (text.length < 30000 && /request for information|sources sought|market (research|assessment)|notice and instructions|cover letter|\brfi\b/.test(head)) {
    return 'notice'
  }
  return 'other'
}
