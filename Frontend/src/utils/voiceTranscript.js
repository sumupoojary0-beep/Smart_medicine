/**
 * Voice transcript cleanup: spoken units/numbers -> text matching medicine names.
 * "paracetamol five hundred milligram" -> "paracetamol 500mg"
 */
const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }

function isNum(w) { return w in UNITS || w in TENS || w === 'hundred' || w === 'thousand' }

// Convert a run of number words to a digit string.
function wordsToNumber(words) {
  let total = 0
  let current = 0
  for (const w of words) {
    if (w in UNITS) current += UNITS[w]
    else if (w in TENS) current = current >= 1 && current <= 9 ? current * 100 + TENS[w] : current + TENS[w] // "six fifty" -> 650
    else if (w === 'hundred') current = (current || 1) * 100
    else if (w === 'thousand') { total += (current || 1) * 1000; current = 0 }
  }
  return String(total + current)
}

function replaceNumberWords(text) {
  const out = []
  let run = []
  const flush = () => { if (run.length) { out.push(wordsToNumber(run)); run = [] } }
  for (const w of text.split(' ')) {
    if (isNum(w)) run.push(w)
    else if (w === 'and' && run.length) continue
    else { flush(); out.push(w) }
  }
  flush()
  return out.join(' ')
}

export function normalizeTranscript(raw) {
  let t = (raw || '').toLowerCase().trim().replace(/[.,!?]+/g, ' ').replace(/\s+/g, ' ')
  t = t.replace(/\b(milli ?grams?|mg\.)\b/g, 'mg')
  t = t.replace(/\b(micro ?grams?)\b/g, 'mcg')
  t = t.replace(/\b(milli ?(?:litres?|liters?))\b/g, 'ml')
  t = replaceNumberWords(t)
  t = t.replace(/(\d)\s+(mg|mcg|ml)\b/g, '$1$2')
  t = t.replace(/\b(search for|search|find|show me|i need|i want|medicine|tablet|tablets)\b/g, ' ')
  return t.replace(/\s+/g, ' ').trim()
}