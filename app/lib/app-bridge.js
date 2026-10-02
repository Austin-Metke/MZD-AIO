/* jshint esversion:8, -W033, -W117, -W097 */
'use strict'
/**
 * Renderer-side stand-ins for the parts of electron.app and electron.dialog
 * the pages used through the removed remote module, and for clipboard, which
 * Electron no longer exposes to renderers. Each call forwards to an ipcMain
 * handler registered in main.js.
 */
const { ipcRenderer } = require('electron')

// Fetched once: the main process sets its paths (including 'home') before any window opens
const info = ipcRenderer.sendSync('app-info')

const app = {
  isPackaged: info.isPackaged,
  getName: () => info.name,
  getVersion: () => info.version,
  getAppPath: () => info.appPath,
  getPath (name) {
    if (!(name in info.paths)) throw new Error(`Failed to get '${name}' path`)
    return info.paths[name]
  },
  quit: () => ipcRenderer.send('app-quit')
}

const dialog = {
  // Synchronous like the main-process API, so callers that quit right after still show the box
  showErrorBox: (title, content) => ipcRenderer.sendSync('show-error-box', String(title), String(content)),
  // Resolves { canceled, filePaths }
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options)
}

const clipboard = {
  // Resolves the clipboard text: Electron's clipboard API is asynchronous now
  readText: () => ipcRenderer.invoke('clipboard-read-text'),
  writeText: (text) => ipcRenderer.send('clipboard-write-text', String(text)),
  // Takes an image file path, as callers passed to the old clipboard.writeImage
  writeImage: (imagePath) => ipcRenderer.send('clipboard-write-image', String(imagePath))
}

module.exports = { app, dialog, clipboard }
