import React, { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { Bot, Send, Sparkles, RefreshCw, Check, Settings, X } from 'lucide-react'
import { PROVIDERS, sendChat, getAiStatus } from './lib/ai.js'

const SETTINGS_KEY = 'ilaf-ai-settings'

const DEFAULT_CODE = `// مرحباً بك في ILAF AI
function welcomeILAF() {
  console.log("Welcome to ILAF AI");
}
`

function loadSettings() {
  try {
    const loaded = {
      provider: 'gemini',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen2.5-coder:1.5b',
      ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    }
    delete loaded.groqKey
    delete loaded.geminiKey
    if (loaded.provider === 'pollinations' || loaded.provider === 'auto' || loaded.provider === 'groq') {
      loaded.provider = 'gemini'
    }
    return loaded
  } catch {
    return {
      provider: 'gemini',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: 'qwen2.5-coder:1.5b'
    }
  }
}

function extractCode(text, query) {
  if (!/كود|برمج|javascript|python|html|css|function|دالة|سكربت/i.test(query || '')) return null
  const match = text.match(/```(?:javascript|js|python|html|css)?\n([\s\S]*?)```/)
  return match ? match[1].trim() : null
}

export default function App() {
  const [code, setCode] = useState(DEFAULT_CODE)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [awaitingFirstToken, setAwaitingFirstToken] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const [connected, setConnected] = useState(false)
  const [statusLabel, setStatusLabel] = useState('جاري الفحص')
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content:
        'مرحباً! أنا ILAF AI.\nاسألني بالعربية عن أي موضوع. إن طلبت برمجة أعطيك كوداً، وإلا أرد بنص واضح.'
    }
  ])
  const chunkRaf = useRef(0)

  const providerName = PROVIDERS[settings.provider]?.label || settings.provider

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    let cancelled = false
    getAiStatus().then((status) => {
      if (cancelled) return
      setConnected(Boolean(status.hasKey) || Boolean(status.ollama))
      setStatusLabel(
        status.hasKey
          ? `Gemini ${status.model}`
          : status.ollama
            ? 'Ollama جاهز'
            : 'غير متصل'
      )
    }).catch(() => {
      if (!cancelled) {
        setConnected(false)
        setStatusLabel('غير متصل')
      }
    })
    return () => {
      cancelled = true
    }
  }, [settings.provider])

  const logoSrc = useMemo(() => `${import.meta.env.BASE_URL}ilaf-logo.svg`, [])

  const applyCodeToEditor = (newCode) => {
    setCode(newCode)
    setMessages((prev) => [...prev, { role: 'system', content: 'تم تطبيق الكود على المحرر بنجاح.' }])
  }

  const handleSendMessage = async () => {
    if (!prompt.trim() || loading) return

    const userQuery = prompt.trim()
    setMessages((prev) => [...prev, { role: 'user', content: userQuery }])
    setPrompt('')
    setLoading(true)
    setAwaitingFirstToken(true)
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

    try {
      const full = await sendChat(
        {
          provider: settings.provider,
          prompt: userQuery,
          editorCode: code,
          ollamaUrl: settings.ollamaUrl,
          ollamaModel: settings.ollamaModel
        },
        (text) => {
          setAwaitingFirstToken(false)
          if (chunkRaf.current) cancelAnimationFrame(chunkRaf.current)
          chunkRaf.current = requestAnimationFrame(() => {
            setMessages((prev) => {
              const updated = [...prev]
              const last = updated[updated.length - 1]
              if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: text }
              return updated
            })
          })
        }
      )

      const extractedCode = extractCode(full, userQuery)
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        if (last?.role === 'assistant') {
          updated[updated.length - 1] = { ...last, content: full, codeSnippet: extractedCode }
        }
        return updated
      })
    } catch (error) {
      setMessages((prev) => {
        const updated = [...prev]
        const last = updated[updated.length - 1]
        const text = `حدث خطأ: ${error.message}`
        if (last?.role === 'assistant') updated[updated.length - 1] = { ...last, content: text }
        else updated.push({ role: 'assistant', content: text })
        return updated
      })
    } finally {
      setAwaitingFirstToken(false)
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#181818', color: '#fff', fontFamily: 'sans-serif' }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
        input:focus, select:focus { border-color: #61dafb !important; box-shadow: 0 0 8px rgba(97, 218, 251, 0.3) !important; }
        button:hover { opacity: 0.9; }
      `}</style>

      <header style={{ height: '75px', borderBottom: '2px solid #FF6B35', display: 'flex', alignItems: 'center', padding: '0 20px', justifyContent: 'space-between', backgroundColor: '#1f1f1f' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1 }}>
          <div style={{ width: '65px', height: '65px', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#252526', borderRadius: '10px', padding: '6px', border: '2px solid #FF6B35' }}>
            <img src={logoSrc} alt="ILAF Logo" style={{ height: '100%', width: '100%', objectFit: 'contain' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', borderLeft: '2px solid #FF6B35', paddingLeft: '16px' }}>
            <Sparkles size={22} color="#FF6B35" />
            <div>
              <div style={{ fontWeight: 'bold', fontSize: '16px' }}>ILAF AI</div>
              <div style={{ fontSize: '11px', color: '#FF6B35', marginTop: '3px', fontWeight: 600 }}>Gemini Flash</div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', backgroundColor: '#2d2d2d', padding: '8px 14px', borderRadius: '8px', border: '1px solid #FF6B35' }}>
            <div style={{ width: '10px', height: '10px', backgroundColor: connected ? '#28a745' : '#dc3545', borderRadius: '50%' }} />
            <span style={{ color: connected ? '#28a745' : '#dc3545', fontWeight: 600 }}>{statusLabel}</span>
          </div>
          <button onClick={() => setSettingsOpen(true)} title="إعدادات" style={{ backgroundColor: '#2d2d2d', border: '1px solid #FF6B35', color: '#fff', borderRadius: '8px', padding: '8px 10px', cursor: 'pointer' }}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, height: '100%' }}>
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={code}
            onChange={(value) => setCode(value || '')}
            options={{ fontSize: 14, minimap: { enabled: true }, automaticLayout: true }}
          />
        </div>

        <div style={{ width: '380px', borderLeft: '1px solid #2b2b2b', backgroundColor: '#1e1e1e', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '15px', borderBottom: '1px solid #2b2b2b', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Bot size={18} color="#61dafb" />
            <h4 style={{ margin: 0 }}>ILAF Assistant</h4>
          </div>

          <div style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {messages.map((msg, idx) => (
              <div key={idx} style={{ alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start', backgroundColor: msg.role === 'user' ? '#005fb8' : msg.role === 'system' ? '#1a4d2e' : '#2d2d2d', padding: '10px 14px', borderRadius: '8px', maxWidth: '85%', fontSize: '13px', lineHeight: '1.4' }}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                {msg.codeSnippet && (
                  <button onClick={() => applyCodeToEditor(msg.codeSnippet)} style={{ marginTop: '10px', backgroundColor: '#28a745', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 'bold' }}>
                    <Check size={14} /> تطبيق الكود على المحرر
                  </button>
                )}
              </div>
            ))}
            {loading && awaitingFirstToken && (
              <div style={{ color: '#61dafb', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <RefreshCw size={14} className="spin" /> جاري الاتصال بـ Gemini...
              </div>
            )}
          </div>

          <div style={{ padding: '15px', borderTop: '1px solid #2b2b2b', display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder="اطلب تعديل الكود..."
              disabled={loading}
              style={{ flex: 1, padding: '10px', borderRadius: '6px', border: '1px solid #3c3c3c', backgroundColor: '#252526', color: '#fff', fontSize: '13px', outline: 'none' }}
            />
            <button onClick={handleSendMessage} disabled={loading} style={{ backgroundColor: '#007acc', border: 'none', borderRadius: '6px', padding: '0 15px', color: '#fff', cursor: loading ? 'wait' : 'pointer' }}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {settingsOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ width: 460, background: '#1f1f1f', border: '1px solid #FF6B35', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <strong>إعدادات الذكاء الاصطناعي</strong>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            <label style={{ fontSize: 12, color: '#bbb' }}>المزوّد الحالي: {providerName}</label>
            <select
              value={settings.provider}
              onChange={(e) => setSettings((s) => ({ ...s, provider: e.target.value }))}
              style={{ width: '100%', margin: '8px 0 14px', padding: 10, borderRadius: 8, background: '#252526', color: '#fff', border: '1px solid #3c3c3c' }}
            >
              {Object.entries(PROVIDERS).map(([id, meta]) => (
                <option key={id} value={id}>{meta.label}</option>
              ))}
            </select>
            <p style={{ fontSize: 12, color: '#aaa', lineHeight: 1.5 }}>
              إن وُجد مفتاح Gemini في ملف .env يُستخدم أولاً. وإلا يُستخدم Ollama المحلي تلقائياً حتى يعمل التطبيق بدون أخطاء.
            </p>
            <input
              placeholder="Ollama URL (احتياطي)"
              value={settings.ollamaUrl}
              onChange={(e) => setSettings((s) => ({ ...s, ollamaUrl: e.target.value }))}
              style={{ width: '100%', marginBottom: 8, padding: 10, borderRadius: 8, background: '#252526', color: '#fff', border: '1px solid #3c3c3c', boxSizing: 'border-box' }}
            />
            <button onClick={() => setSettingsOpen(false)} style={{ width: '100%', marginTop: 8, background: '#FF6B35', border: 'none', color: '#fff', padding: 10, borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
              حفظ
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
