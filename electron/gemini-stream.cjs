const https = require('https')
const crypto = require('crypto')
const { getGeminiKey, getGeminiModel } = require('./load-env.cjs')

const SYSTEM_PROMPT = 'أنت ILAF AI، مساعد عام. أجب بنص عربي واضح. لا تكتب كوداً إلا إذا طلب المستخدم البرمجة صراحة. لا تختلق أسعار عملات أو أرقاماً حيّة.'
const TTFT_MS = 12000
const TOTAL_MS = 40000
const CACHE_TTL_MS = 60000
const cache = new Map()

class GeminiError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
    this.name = 'GeminiError'
  }
}

function cacheKey(prompt, editorCode) {
  return crypto.createHash('sha1').update(`${prompt}\n${editorCode || ''}`).digest('hex')
}

function readCache(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.text
}

function writeCache(key, text) {
  cache.set(key, { text, at: Date.now() })
  if (cache.size > 50) {
    const first = cache.keys().next().value
    cache.delete(first)
  }
}

function mapStatusError(status, body) {
  const snippet = (body || '').slice(0, 220)
  if (status === 400 && /API_KEY_INVALID|API key not valid|invalid|key/i.test(body || '')) {
    return new GeminiError('invalid_key', 'مفتاح Gemini غير صالح. حدّث GEMINI_API_KEY في ملف .env')
  }
  if (status === 401 || status === 403) {
    return new GeminiError('invalid_key', 'مفتاح Gemini مرفوض. أنشئ مفتاحاً مجانياً من aistudio.google.com/apikey')
  }
  if (status === 429) {
    return new GeminiError('rate_limit', 'تم تجاوز حد Gemini المجاني مؤقتاً. أعد المحاولة بعد قليل.')
  }
  if (status >= 500) {
    return new GeminiError('unavailable', 'خدمة Gemini غير متاحة حالياً.')
  }
  return new GeminiError('http', `Gemini ${status}: ${snippet || 'خطأ غير معروف'}`)
}

function buildPayload(prompt, editorCode, systemPrompt) {
  const userText = prompt
  return {
    systemInstruction: { parts: [{ text: systemPrompt || SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      candidateCount: 1,
      thinkingConfig: { thinkingBudget: 0 }
    }
  }
}

function extractSseText(payload) {
  try {
    const json = JSON.parse(payload)
    const parts = json.candidates?.[0]?.content?.parts || []
    return parts.map((part) => part.text || '').join('')
  } catch {
    return ''
  }
}

function streamOnce(model, payload, onChunk, signal) {
  const key = getGeminiKey()
  const body = JSON.stringify(payload)
  const path = `/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`

  return new Promise((resolve, reject) => {
    let full = ''
    let buffer = ''
    let settled = false
    let firstToken = false
    let status = 0
    const started = Date.now()

    const fail = (err) => {
      if (settled) return
      settled = true
      reject(err)
    }
    const succeed = () => {
      if (settled) return
      settled = true
      resolve({ text: full, ttftMs: firstTokenAt, totalMs: Date.now() - started })
    }

    let firstTokenAt = null
    let ttftTimer
    let totalTimer
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Accept: 'text/event-stream'
        }
      },
      (res) => {
        status = res.statusCode || 0
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          if (signal?.aborted) {
            req.destroy()
            return
          }
          buffer += chunk
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (!data || data === '[DONE]') continue
            if (status && status >= 400) {
              clearTimeout(ttftTimer)
              clearTimeout(totalTimer)
              fail(mapStatusError(status, data))
              return
            }
            const piece = extractSseText(data)
            if (!piece) continue
            if (!firstToken) {
              firstToken = true
              firstTokenAt = Date.now() - started
              clearTimeout(ttftTimer)
            }
            full += piece
            onChunk?.(full)
          }
        })
        res.on('end', () => {
          clearTimeout(ttftTimer)
          clearTimeout(totalTimer)
          if (status >= 400) {
            fail(mapStatusError(status, buffer || full))
            return
          }
          if (!full.trim()) {
            fail(new GeminiError('empty', 'Gemini أعاد رداً فارغاً.'))
            return
          }
          succeed()
        })
      }
    )

    req.on('error', (err) => {
      clearTimeout(ttftTimer)
      clearTimeout(totalTimer)
      if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
        fail(new GeminiError('timeout', 'انتهت مهلة الاتصال بـ Gemini.'))
        return
      }
      fail(new GeminiError('network', `تعذر الاتصال بـ Gemini: ${err.message}`))
    })

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy()
        fail(new GeminiError('aborted', 'تم إلغاء الطلب.'))
      })
    }

    req.write(body)
    req.end()
    ttftTimer = setTimeout(() => {
      req.destroy()
      fail(new GeminiError('timeout', 'انتهت مهلة انتظار أول جزء من الرد (TTFT).'))
    }, TTFT_MS)
    totalTimer = setTimeout(() => {
      req.destroy()
      fail(new GeminiError('timeout', 'انتهت مهلة الرد من Gemini.'))
    }, TOTAL_MS)
  })
}

async function streamGemini({ prompt, editorCode, systemPrompt }, onChunk, options = {}) {
  const key = getGeminiKey()
  if (!key) {
    throw new GeminiError(
      'missing_key',
      'ضع GEMINI_API_KEY في ملف .env (مفتاح مجاني من aistudio.google.com/apikey). لا تضع المفتاح في الواجهة.'
    )
  }

  const promptText = (prompt || '').trim()
  if (!promptText) throw new GeminiError('empty', 'الطلب فارغ.')

  const keyHash = cacheKey(promptText, editorCode)
  const cached = readCache(keyHash)
  if (cached) {
    onChunk?.(cached)
    return { text: cached, cached: true, ttftMs: 0, totalMs: 0, model: getGeminiModel() }
  }

  const model = options.model || getGeminiModel()
  const payload = buildPayload(promptText, editorCode, systemPrompt)

  const run = async (useThinking) => {
    const body = useThinking ? payload : { ...payload, generationConfig: { ...payload.generationConfig } }
    if (!useThinking) delete body.generationConfig.thinkingConfig
    return streamOnce(model, body, onChunk, options.signal)
  }

  try {
    const result = await run(true)
    writeCache(keyHash, result.text)
    return { ...result, cached: false, model }
  } catch (error) {
    if (/thinkingConfig|Unknown name/i.test(error.message || '')) {
      const retry = await run(false)
      writeCache(keyHash, retry.text)
      return { ...retry, cached: false, model }
    }
    if (error.code === 'unavailable' || error.code === 'network') {
      await new Promise((r) => setTimeout(r, 350))
      const retry = await run(false)
      writeCache(keyHash, retry.text)
      return { ...retry, cached: false, model }
    }
    throw error
  }
}

module.exports = { streamGemini, GeminiError, getGeminiKey, getGeminiModel }
