// Preload for the isolated GIS auth window (renderer/auth/auth-gis.html).
//
// This window is a throwaway Google-sign-in surface with NO access to Lore's
// real IPC bridge. The only thing it can do is hand ONE result object back to
// the main process — a token on success, or an error/cancel marker. It cannot
// read files, call the backend, or invoke any other channel. Keeping the bridge
// this thin is the whole point of isolating GIS here instead of the main app.
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('__authBridge', {
  // payload: { ok:true, mode, idToken|accessToken } | { ok:false, error }
  result: (payload) => ipcRenderer.send('auth-gis:result', payload),
});
