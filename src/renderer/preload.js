const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Renderer to Main - Updated to support multiple arguments
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // Main to Renderer
  on: (channel, func) => {
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
});
