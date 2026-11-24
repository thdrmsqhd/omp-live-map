"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineeringDesktop", {
  request: (endpoint, params, payload) => ipcRenderer.invoke("engineering:request", { endpoint, params, payload }),
});
