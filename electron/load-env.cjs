const fs = require('fs')
const path = require('path')

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] == null || process.env[key] === '') process.env[key] = value
  }
}

function loadEnvFiles(extraPaths = []) {
  const candidates = [
    ...extraPaths,
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env')
  ]
  try {
    const { app } = require('electron')
    if (app?.isReady?.() || app) {
      candidates.unshift(path.join(app.getPath('userData'), '.env'))
      if (app.isPackaged) candidates.unshift(path.join(path.dirname(process.execPath), '.env'))
    }
  } catch {
    // not running inside Electron
  }
  const seen = new Set()
  for (const filePath of candidates) {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) continue
    seen.add(resolved)
    parseEnvFile(resolved)
  }
}

function getGeminiKey() {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim()
}

function getGeminiModel() {
  return (process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim()
}

module.exports = { loadEnvFiles, getGeminiKey, getGeminiModel }
