import { contextBridge, ipcRenderer } from "electron";
import { invoke, events, send } from "./ipcAllowlist.generated.js";

const INVOKE_CHANNELS = new Set(invoke);
const EVENT_CHANNELS = new Set(events);
const SEND_CHANNELS = new Set(send);

const channelError = (kind, channel) =>
  `[IPC] Canal "${channel}" no permitido en ${kind}. ` +
  `No está en el allowlist de preload (src/renderer/ipcAllowlist.generated.js).`;

const isAllowed = (set, kind, channel) => {
  if (typeof channel === "string" && set.has(channel)) return true;
  console.error(channelError(kind, channel));
  return false;
};

contextBridge.exposeInMainWorld("api", {
  // Renderer to Main - Updated to support multiple arguments
  invoke: (channel, ...args) => {
    if (!isAllowed(INVOKE_CHANNELS, "invoke", channel)) {
      return Promise.reject(new Error(channelError("invoke", channel)));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  // Notifica al main el modo claro/oscuro para colorear el título nativo
  setTitlebarTheme: (mode) => {
    if (!isAllowed(SEND_CHANNELS, "send", "set-titlebar-theme")) return;
    ipcRenderer.send("set-titlebar-theme", mode);
  },
  // Main to Renderer
  on: (channel, func) => {
    if (!isAllowed(EVENT_CHANNELS, "on", channel)) {
      return () => {};
    }
    const subscription = (event, ...args) => func(...args);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
});
