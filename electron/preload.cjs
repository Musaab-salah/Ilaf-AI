const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('ilafDesktop', {
  isDesktop: true,
  chat: (payload) =>
    new Promise((resolve, reject) => {
      const requestId = payload.requestId
      const onDone = (_event, data) => {
        if (data.requestId !== requestId) return
        ipcRenderer.removeListener('ai:done', onDone)
        if (data.error) reject(new Error(data.error))
        else resolve(data.text)
      }
      ipcRenderer.on('ai:done', onDone)
      ipcRenderer.send('ai:chat', payload)
    }),
  getStatus: () => ipcRenderer.invoke('ai:status'),
  checkOllama: (url) => ipcRenderer.invoke('ai:ollama-status', url),
  onChunk: (requestId, callback) => {
    const listener = (_event, data) => {
      if (data.requestId === requestId) callback(data.text)
    }
    ipcRenderer.on('ai:chunk', listener)
    return () => ipcRenderer.removeListener('ai:chunk', listener)
  }
})
