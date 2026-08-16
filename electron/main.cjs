const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const { loadEnvFiles } = require('./load-env.cjs')
const { chat, checkOllama, getStatus } = require('./ai.cjs')

const isDev = !app.isPackaged

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#181818',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.setMenuBarVisibility(false)

  if (isDev) {
    win.loadURL('http://127.0.0.1:5173')
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

ipcMain.on('ai:chat', async (event, payload) => {
  const requestId = payload.requestId
  try {
    const text = await chat(
      {
        provider: payload.provider,
        prompt: payload.prompt,
        editorCode: payload.editorCode,
        ollamaUrl: payload.ollamaUrl,
        ollamaModel: payload.ollamaModel
      },
      (text) => {
        event.sender.send('ai:chunk', { requestId, text })
      }
    )
    event.sender.send('ai:done', { requestId, text })
  } catch (error) {
    event.sender.send('ai:done', { requestId, error: error.message, code: error.code })
  }
})

ipcMain.handle('ai:status', async () => getStatus())
ipcMain.handle('ai:ollama-status', async (_event, url) => checkOllama(url))

app.whenReady().then(() => {
  loadEnvFiles()
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
