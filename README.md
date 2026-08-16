# Ilaf AI

Desktop AI assistant with a code editor and chat. It answers in Arabic text by default, uses live exchange rates for currency questions, and writes code only when you ask for programming help.

## Run

```bash
npm install
npm run electron:dev
```

Optional Gemini (faster, free-tier key from [Google AI Studio](https://aistudio.google.com/apikey)):

```
GEMINI_API_KEY=your_key
GEMINI_MODEL=gemini-2.5-flash-lite
```

Put this in `.env` (never commit it). Without a key, Ilaf AI uses local Ollama when available.

## Build Windows app

```bash
npm run build
```

The portable app lives under `release/ILAF-AI/`.
