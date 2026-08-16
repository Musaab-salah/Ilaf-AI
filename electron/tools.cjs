const CURRENCIES = [
  { code: 'USD', names: ['usd', 'dollar', 'dollars', 'دولار', 'دولارات', 'دولارا'] },
  { code: 'AED', names: ['aed', 'dirham', 'درهم', 'دراهم', 'امارات', 'إمارات', 'اماراتي', 'إماراتي'] },
  { code: 'SAR', names: ['sar', 'riyal', 'ريال سعود', 'سعودي'] },
  { code: 'EUR', names: ['eur', 'euro', 'يورو'] },
  { code: 'GBP', names: ['gbp', 'pound', 'sterling', 'جنيه استرليني', 'إسترليني'] },
  { code: 'EGP', names: ['egp', 'جنيه مصر', 'مصري'] },
  { code: 'KWD', names: ['kwd', 'دينار كويت', 'كويتي'] },
  { code: 'QAR', names: ['qar', 'ريال قطر', 'قطري'] }
]

const NAMES = {
  USD: 'الدولار الأمريكي',
  AED: 'الدرهم الإماراتي',
  SAR: 'الريال السعودي',
  EUR: 'اليورو',
  GBP: 'الجنيه الإسترليني',
  EGP: 'الجنيه المصري',
  KWD: 'الدينار الكويتي',
  QAR: 'الريال القطري'
}

function normalize(text) {
  return String(text || '').toLowerCase()
}

function detectIntent(prompt) {
  const q = normalize(prompt)
  const coding =
    /javascript|python|html|css|react|function|كود|برمج|برمجي|دالة|سكربت|syntax|bug|خطأ في الكود|حسّن الكود|هذا الكود|اكتب لي كود/.test(q)
  const currency =
    /usd|aed|eur|sar|dollar|dirham|دولار|درهم|عملة|صرف|سعر.*دولار|دولار.*درهم|درهم.*دولار/.test(q)
  if (currency && !coding) return 'currency'
  if (coding) return 'coding'
  return 'general'
}

function findCurrencies(prompt) {
  const q = normalize(prompt)
  const found = []
  for (const item of CURRENCIES) {
    if (item.names.some((name) => q.includes(name))) found.push(item.code)
  }
  if (found.includes('USD') && found.includes('AED')) return ['USD', 'AED']
  if (found.length >= 2) return found.slice(0, 2)
  if (found.includes('USD')) return ['USD', 'AED']
  if (found.includes('AED')) return ['USD', 'AED']
  if (found.length === 1) return ['USD', found[0]]
  return ['USD', 'AED']
}

async function fetchJson(url, timeoutMs = 8000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRates(base) {
  try {
    const data = await fetchJson(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`)
    if (data.result === 'success' && data.rates) {
      return { rates: data.rates, date: data.time_last_update_utc || new Date().toUTCString(), source: 'open.er-api.com' }
    }
  } catch {
    // try fallback
  }
  const json = await fetchJson('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json')
  const rates = {}
  for (const [code, value] of Object.entries(json.usd || {})) {
    rates[code.toUpperCase()] = value
  }
  rates.USD = 1
  return { rates, date: json.date || new Date().toISOString().slice(0, 10), source: 'currency-api' }
}

async function answerCurrency(prompt) {
  const [from, to] = findCurrencies(prompt)
  const data = await fetchRates(from)
  const rate = data.rates[to]
  if (!rate) throw new Error(`لا يتوفر سعر ${from}/${to} حالياً.`)
  const inverse = 1 / rate
  const fromName = NAMES[from] || from
  const toName = NAMES[to] || to
  return [
    `سعر ${fromName} مقابل ${toName} (حيّ، ليس تخميناً):`,
    '',
    `1 ${from} = ${Number(rate).toFixed(4)} ${to}`,
    `1 ${to} = ${inverse.toFixed(4)} ${from}`,
    '',
    `التحديث: ${data.date}`,
    `المصدر: ${data.source}`
  ].join('\n')
}

function systemPromptFor(intent) {
  if (intent === 'coding') {
    return 'أنت ILAF AI. إن طلب المستخدم كوداً فأعطه الكود داخل صندوق لغته المناسبة. اشرح باختصار بالعربية. لا تختلق بيانات حيّة مثل أسعار العملات.'
  }
  return 'أنت ILAF AI، مساعد عام. أجب بنص عربي واضح ومباشر. لا تكتب كود JavaScript ولا أي كود إلا إذا طلب المستخدم البرمجة صراحة. لا تختلق أرقاماً أو أسعار صرف.'
}

function buildUserMessage(intent, prompt, editorCode) {
  if (intent === 'coding' && editorCode) {
    return `كود المحرر:\n\`\`\`javascript\n${editorCode.slice(0, 1600)}\n\`\`\`\n\nطلب المستخدم:\n${prompt}`
  }
  return prompt
}

module.exports = { detectIntent, answerCurrency, systemPromptFor, buildUserMessage }
