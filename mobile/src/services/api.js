import * as SecureStore from "expo-secure-store";
import * as Network from "expo-network";

let baseURL = null;
let authToken = null;

const API_PORT = 3456;
const TOKEN_KEY = "pos_auth_token";
const HOST_KEY = "pos_host";

const probeIP = async (ip, timeout = 1500) => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(`http://${ip}:${API_PORT}/api/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: "probe" }),
      signal: controller.signal,
    });
    clearTimeout(id);
    return true;
  } catch {
    return false;
  }
};

const getSubnetIPs = (ip) => {
  const parts = ip.split(".");
  if (parts.length !== 4) return [];
  const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
  const ips = [];
  for (let i = 1; i <= 254; i++) {
    ips.push(`${prefix}${i}`);
  }
  return ips;
};

const discover = async () => {
  try {
    const ip = await Network.getIpAddressAsync();
    if (ip && ip !== "0.0.0.0") {
      const ips = getSubnetIPs(ip);
      // Probe in parallel batches of 10
      for (let i = 0; i < ips.length; i += 10) {
        const batch = ips.slice(i, i + 10);
        const results = await Promise.all(batch.map((ip) => probeIP(ip, 1000)));
        const found = batch.find((_, idx) => results[idx]);
        if (found) return found;
      }
    }
  } catch {}
  return null;
};

const loadSavedHost = async () => {
  try {
    const host = await SecureStore.getItemAsync(HOST_KEY);
    const token = await SecureStore.getItemAsync(TOKEN_KEY);
    if (host) baseURL = `http://${host}:${API_PORT}`;
    if (token) authToken = token;
    return { host, token };
  } catch {
    return { host: null, token: null };
  }
};

export const initialize = async () => {
  const saved = await loadSavedHost();
  if (saved.host) {
    baseURL = `http://${saved.host}:${API_PORT}`;
    // Test connection
    try {
      const test = await fetch(`${baseURL}/api/auth`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "test" }),
        signal: AbortSignal.timeout(3000),
      });
      if (test.ok || test.status === 401) return { connected: true };
    } catch {}
  }

  const serverIP = await discover();
  if (serverIP) {
    baseURL = `http://${serverIP}:${API_PORT}`;
    await SecureStore.setItemAsync(HOST_KEY, serverIP);
    return { connected: true, discovered: true };
  }

  return { connected: false };
};

export const authenticate = async (id, pin) => {
  const res = await fetch(`${baseURL}/api/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, pin }),
  });
  const data = await res.json();
  if (data.success) {
    authToken = data.token;
    await SecureStore.setItemAsync(TOKEN_KEY, data.token);
    return { success: true, cashier: data.cashier };
  }
  return { success: false, error: data.error };
};

export const getCashiers = () => apiFetch("/api/cashiers");

const apiFetch = async (path, options = {}) => {
  if (!baseURL) throw new Error("No conectado al servidor");

  const headers = { ...options.headers };
  if (authToken) headers["Authorization"] = authToken;

  const res = await fetch(`${baseURL}${path}`, { ...options, headers });
  const data = await res.json();

  if (res.status === 401) {
    authToken = null;
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    throw new Error("Sesión expirada");
  }

  if (!data.success) throw new Error(data.error || "Error del servidor");
  return data;
};

export const searchProducts = (query) =>
  apiFetch(`/api/products/search?q=${encodeURIComponent(query)}`);

export const getProductByBarcode = (barcode) =>
  apiFetch(`/api/products/${encodeURIComponent(barcode)}`);

export const createProduct = (product) =>
  apiFetch("/api/products", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(product),
  });

export const addStock = (productId, quantity, cost = "", notes = "", registerExpense = true, updateCostPrice = null) => {
  const body = { quantity, cost: parseFloat(cost) || 0, notes, registerExpense };
  if (typeof updateCostPrice === "number") body.updateCostPrice = updateCostPrice;
  return apiFetch(`/api/products/${productId}/stock`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
};

export const getCategories = () => apiFetch("/api/categories");

export const logout = async () => {
  authToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
};

export const resetConnection = async () => {
  baseURL = null;
  authToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await SecureStore.deleteItemAsync(HOST_KEY);
};
