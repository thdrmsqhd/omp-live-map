"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engineeringDesktop", {
  localMonaco: process.argv.includes("--omp-local-monaco"),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
});
