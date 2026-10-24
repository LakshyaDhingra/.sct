const { app, session } = require('electron')

app.setPath('userData', process.argv[2])
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (_details, callback) => callback({ cancel: true })
  )
  require('../out/main/index.js')
})
