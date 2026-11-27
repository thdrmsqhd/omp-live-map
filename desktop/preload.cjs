"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineeringDesktop", {
  localMonaco: process.argv.includes("--omp-local-monaco"),
  request: (endpoint, params, payload) => ipcRenderer.invoke("engineering:request", { endpoint, params, payload }),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
});
