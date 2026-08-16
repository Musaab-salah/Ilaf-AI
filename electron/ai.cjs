const http = require('http')
const { URL } = require('url')
const { streamGemini, getGeminiKey, getGeminiModel } = require('./gemini-stream.cjs')
const { detectIntent, answerCurrency, systemPromptFor, buildUserMessage } = require('./tools.cjs')

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
const GENERAL_MODEL = 'qwen2.5:1.5b'

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

async function pickOllamaModel(payload) {
  const requested = payload.ollamaModel || CODING_MODEL
  if (payload.intent === 'coding') return requested
  const models = await listOllamaModels(payload.ollamaUrl)
  const general = models.find((name) => name === GENERAL_MODEL || (name.startsWith('qwen2.5:') && !name.includes('coder')))
  return general || requested
}

async function chatOllama(payload, onChunk) {
  const base = (payload.ollamaUrl || 'http://127.0.0.1:11434').replace(/\/$/, '')
  const messages = [
    { role: 'system', content: payload.systemPrompt || systemPromptFor('general') },
    { role: 'user', content: payload.userMessage || payload.prompt || '' }
  ]
  const body = {
    model: await pickOllamaModel(payload),
    messages,
    stream: true,
    keep_alive: '60m',
    options: { temperature: 0.2, num_ctx: 2048, num_predict: 400 }
  }
  const res = await ollamaHttpPost(base, '/api/chat', body)
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Ollama ${res.statusCode}. تأكد أن ollama serve يعمل.`)
  }
  return readNodeOllamaStream(res, onChunk)
}

function ollamaHttpPost(base, pathname, body) {
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
    req.setTimeout(25000, () => {
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
