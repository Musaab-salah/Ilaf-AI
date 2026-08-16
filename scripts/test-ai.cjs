const { loadEnvFiles, getGeminiKey } = require('../electron/load-env.cjs')
const { streamGemini, GeminiError } = require('../electron/gemini-stream.cjs')

loadEnvFiles()

async function run() {
  const results = []

  const original = process.env.GEMINI_API_KEY
  process.env.GEMINI_API_KEY = ''
  try {
    await streamGemini({ prompt: 'hi', editorCode: '' }, () => {})
    results.push(['missing_key', 'FAIL: should throw'])
  } catch (e) {
    results.push(['missing_key', e.code === 'missing_key' ? 'PASS' : `FAIL ${e.code || e.message}`])
  }

  process.env.GEMINI_API_KEY = 'invalid-test-key'
  const t0 = Date.now()
  try {
    await streamGemini({ prompt: 'hi', editorCode: 'console.log(1)' }, () => {})
    results.push(['invalid_key', 'FAIL: should throw'])
  } catch (e) {
    const ms = Date.now() - t0
    const ok = e.code === 'invalid_key' || e.code === 'http' || e.code === 'network'
    results.push(['invalid_key', ok ? `PASS (${e.code}, ${ms}ms)` : `FAIL ${e.code || e.message}`])
  }

  process.env.GEMINI_API_KEY = original || ''
  if (getGeminiKey()) {
    let chunks = 0
    let ttft = null
    const start = Date.now()
    const result = await streamGemini({ prompt: 'Reply with the word OK', editorCode: '' }, () => {
      chunks += 1
      if (ttft == null) ttft = Date.now() - start
    })
    results.push(['live_stream', `PASS ttft=${result.ttftMs ?? ttft}ms chunks=${chunks} text=${JSON.stringify(result.text.slice(0, 40))}`])
  } else {
    results.push(['live_stream', 'SKIP no GEMINI_API_KEY'])
  }

  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ai.js'), 'utf8')
  const exposed = /GEMINI_API_KEY|generativelanguage\.googleapis\.com/.test(src)
  results.push(['key_not_in_frontend', exposed ? 'FAIL frontend references Gemini key/API' : 'PASS'])

  for (const [name, status] of results) console.log(`${name}: ${status}`)
  if (results.some(([, s]) => s.startsWith('FAIL'))) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
