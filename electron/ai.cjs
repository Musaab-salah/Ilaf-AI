const http = require('http')
const { URL } = require('url')
const { streamGemini, getGeminiKey, getGeminiModel } = require('./gemini-stream.cjs')
const { detectIntent, answerCurrency, systemPromptFor, buildUserMessage, fetchContext, buildGroundedMessage, looksLikeRefusal, formatSourceAnswer } = require('./tools.cjs')

async function chat(payload, onChunk) {
  const prompt = (payload.prompt || '').trim()
  const intent = detectIntent(prompt)

  if (intent === 'currency') {
    const text = await answerCurrency(prompt)
    onChunk?.(text)
    return text
  }

  payload.intent = intent
  payload.systemPrompt = systemPromptFor(intent)
  payload.userMessage = buildUserMessage(intent, prompt, payload.editorCode)

  if (intent === 'general') {
    payload.context = await fetchContext(prompt)
    if (payload.context) payload.userMessage = buildGroundedMessage(prompt, payload.context)
  }

  const provider = payload.provider === 'ollama' ? 'ollama' : 'gemini'
  if (provider === 'ollama') return chatOllama(payload, onChunk)

  if (getGeminiKey()) {
    try {
      const result = await streamGemini(
        {
          prompt: payload.userMessage,
          editorCode: '',
          systemPrompt: payload.systemPrompt
        },
        onChunk
      )
      return result.text
    } catch (error) {
      if (await checkOllama(payload.ollamaUrl)) return chatOllama(payload, onChunk)
      throw error
    }
  }

  if (await checkOllama(payload.ollamaUrl)) return chatOllama(payload, onChunk)
  throw new Error('ضع GEMINI_API_KEY في ملف .env أو شغّل Ollama محلياً.')
}

const CODING_MODEL = 'qwen2.5-coder:1.5b'
const GENERAL_MODELS = ['qwen2.5:7b', 'llama3.1:8b', 'qwen2.5:3b', 'qwen2.5:1.5b']

async function listOllamaModels(url = 'http://127.0.0.1:11434') {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`)
    if (!res.ok) return []
    const data = await res.json()
    return (data.models || []).map((m) => m.name)
  } catch {
    return []
  }
}

async function pickOllamaModel(payload, onChunk) {
  const requested = payload.ollamaModel || CODING_MODEL
  if (payload.intent === 'coding') return requested
  const models = await listOllamaModels(payload.ollamaUrl)
  for (const preferred of GENERAL_MODELS) {
    if (models.includes(preferred)) return preferred
  }
  const general = models.find((name) => name.startsWith('qwen2.5:') && !name.includes('coder'))
  if (general) return general
  const fallback = models.find((name) => !name.includes('coder') && !name.includes('embed'))
  if (fallback) return fallback
  const pulled = await pullOllamaModel(payload.ollamaUrl, GENERAL_MODELS[GENERAL_MODELS.length - 1], onChunk)
  return pulled || requested
}

async function pullOllamaModel(url, model, onChunk) {
  const base = (url || 'http://127.0.0.1:11434').replace(/\/$/, '')
  try {
    onChunk?.(`جارٍ تحميل النموذج العام ${model} لأول مرة (مرة واحدة فقط)...`)
    const res = await ollamaHttpPost(base, '/api/pull', { name: model, stream: true }, 30 * 60 * 1000)
    if (res.statusCode < 200 || res.statusCode >= 300) return null
    await new Promise((resolve, reject) => {
      let buffer = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        buffer += chunk
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const json = JSON.parse(line)
            if (json.total && json.completed) {
              const pct = Math.round((json.completed / json.total) * 100)
              onChunk?.(`جارٍ تحميل النموذج العام ${model}... ${pct}%`)
            }
          } catch {
            // ignore
          }
        }
      })
      res.on('end', resolve)
      res.on('error', reject)
    })
    const models = await listOllamaModels(base)
    return models.includes(model) ? model : null
  } catch {
    return null
  }
}

async function chatOllama(payload, onChunk) {
  const base = (payload.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const messages = [
    { role: 'system', content: payload.systemPrompt || systemPromptFor('general') },
    { role: 'user', content: payload.userMessage || payload.prompt || '' }
  ]
  const body = {
    model: await pickOllamaModel(payload, onChunk),
    messages,
    stream: true,
    keep_alive: '60m',
    options: { temperature: 0.2, num_ctx: 8192, num_predict: 768 }
  }
  let full
  try {
    const res = await ollamaHttpPost(base, '/api/chat', body, 120000)
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw new Error(`Ollama ${res.statusCode}. تأكد أن ollama serve يعمل.`)
    }
    full = await readNodeOllamaStream(res, onChunk)
  } catch (error) {
    if (payload.context) {
      const text = formatSourceAnswer(payload.context)
      onChunk?.(text)
      return text
    }
    throw error
  }
  if (payload.intent === 'general' && payload.context && looksLikeRefusal(full)) {
    const text = formatSourceAnswer(payload.context)
    onChunk?.(text)
    return text
  }
  return full
}

function ollamaHttpPost(base, pathname, body, timeoutMs = 25000) {
  const u = new URL(pathname, `${base}/`)
  const payload = JSON.stringify(body)
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port || 11434,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        }
      },
      (res) => resolve(res)
    )
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      reject(new Error('انتهت مهلة Ollama.'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function readNodeOllamaStream(res, onChunk) {
  return new Promise((resolve, reject) => {
    let full = ''
    let buffer = ''
    res.setEncoding('utf8')
    res.on('data', (chunk) => {
      buffer += chunk
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const json = JSON.parse(line)
          const piece = json.message?.content || json.response || ''
          if (piece) {
            full += piece
            onChunk?.(full)
          }
        } catch {
          // ignore
        }
      }
    })
    res.on('end', () => {
      if (!full) reject(new Error('Ollama أعاد رداً فارغاً'))
      else resolve(full)
    })
    res.on('error', reject)
  })
}

async function checkOllama(url = 'http://127.0.0.1:11434') {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`)
    return res.ok
  } catch {
    return false
  }
}

async function getStatus() {
  const hasKey = Boolean(getGeminiKey())
  const ollama = await checkOllama()
  return {
    hasKey,
    ollama,
    model: hasKey ? getGeminiModel() : 'qwen2.5-coder:1.5b',
    provider: hasKey ? 'gemini' : ollama ? 'ollama' : 'offline'
  }
}

module.exports = { chat, checkOllama, getStatus }
