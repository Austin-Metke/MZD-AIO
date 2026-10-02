// Expose the app/dialog bridge to page scripts (contextIsolation is off, so
// they share this window). It replaces the removed remote module.
window.appBridge = require('./lib/app-bridge')
