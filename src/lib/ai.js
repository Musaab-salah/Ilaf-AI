const PROVIDERS = {
  gemini: { label: 'Google Gemini Flash (افتراضي)' },
  ollama: { label: 'Ollama (محلي احتياطي)' }
}

function newRequestId() {
  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

export { PROVIDERS }

export async function getAiStatus() {
  if (window.ilafDesktop?.getStatus) return window.ilafDesktop.getStatus()
  try {
    const res = await fetch('/api/ai/status')
    return await res.json()
  } catch {
    return { hasKey: false, model: 'gemini-2.5-flash-lite', provider: 'unknown' }
  }
}

export async function sendChat(payload, onChunk) {
  const request = {
    provider: payload.provider === 'ollama' ? 'ollama' : 'gemini',
    prompt: payload.prompt,
    editorCode: payload.editorCode,
    ollamaUrl: payload.ollamaUrl,
    ollamaModel: payload.ollamaModel
  }

  if (window.ilafDesktop?.chat) {
    const requestId = newRequestId()
    const stop = window.ilafDesktop.onChunk(requestId, onChunk)
    try {
      return await window.ilafDesktop.chat({ ...request, requestId })
    } finally {
      stop()
    }
  }

  const res = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request)
  })
  if (!res.ok || !res.body) throw new Error(`تعذر بدء البث (${res.status})`)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = JSON.parse(trimmed.slice(5).trim() || '{}')
      if (data.error) throw new Error(data.error)
      if (data.text) {
        full = data.text
        onChunk?.(full)
      }
    }
  }

  if (!full) throw new Error('لم تصل استجابة من الذكاء الاصطناعي')
  return full
}
