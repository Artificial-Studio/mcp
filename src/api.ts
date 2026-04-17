const BASE_URL = "https://api.artificialstudio.ai";

export interface Generation {
  id: string;
  status: "pending" | "processing" | "uploading" | "success" | "error";
  tool: string;
  type?: string;
  output?: string;
  thumbnail?: string;
  error?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface SearchResult {
  slug: string;
  name: string;
  description: string;
  type: string;
  outputType: string;
  models: Array<{
    slug: string;
    name: string;
    cost: number;
    costUnit: string;
    inputSchema: Record<string, unknown>;
  }>;
}

export interface UploadResult {
  id: string;
  url: string;
  type: string;
  createdAt: string;
}

export interface AccountInfo {
  id: string;
  email: string;
  credits: number;
  plan: string;
  createdAt: string;
}

function headers(apiKey: string, json = false): Record<string, string> {
  const h: Record<string, string> = { Authorization: apiKey };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function request<T>(url: string, apiKey: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...options, headers: { ...headers(apiKey, !!options?.body), ...options?.headers } });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function searchTools(apiKey: string, query: string): Promise<{ data: SearchResult[] }> {
  return request(`${BASE_URL}/api/search?q=${encodeURIComponent(query)}`, apiKey);
}

export async function getTools(apiKey: string): Promise<{ data: SearchResult[] }> {
  return request(`${BASE_URL}/api/tools`, apiKey);
}

export async function getToolDetail(apiKey: string, slug: string): Promise<SearchResult> {
  return request(`${BASE_URL}/api/tools/${encodeURIComponent(slug)}`, apiKey);
}

export async function createGeneration(
  apiKey: string,
  tool: string,
  input: Record<string, unknown>
): Promise<Generation> {
  return request(`${BASE_URL}/api/run`, apiKey, {
    method: "POST",
    body: JSON.stringify({ tool, input }),
  });
}

export async function getGeneration(apiKey: string, id: string): Promise<Generation> {
  return request(`${BASE_URL}/api/generations/${encodeURIComponent(id)}`, apiKey);
}

export async function pollGeneration(
  apiKey: string,
  id: string,
  intervalMs = 5000,
  timeoutMs = 600000
): Promise<Generation> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const gen = await getGeneration(apiKey, id);
    if (gen.status === "success") return gen;
    if (gen.status === "error") throw new Error(gen.error || "Generation failed");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Generation ${id} timed out after ${timeoutMs / 1000}s`);
}

export async function listGenerations(
  apiKey: string,
  params?: { limit?: number; offset?: number; status?: string }
): Promise<{ data: Generation[]; pagination: { total: number; limit: number; offset: number; hasMore: boolean } }> {
  const qs = new URLSearchParams();
  if (params?.limit) qs.set("limit", String(params.limit));
  if (params?.offset) qs.set("offset", String(params.offset));
  if (params?.status) qs.set("status", params.status);
  const query = qs.toString();
  return request(`${BASE_URL}/api/generations${query ? `?${query}` : ""}`, apiKey);
}

export async function uploadFile(apiKey: string, filePath: string): Promise<UploadResult> {
  const fs = await import("fs");
  const path = await import("path");
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), fileName);

  const res = await fetch(`${BASE_URL}/files`, {
    method: "POST",
    headers: { Authorization: apiKey },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(body.message || `HTTP ${res.status}`);
  }

  return res.json() as Promise<UploadResult>;
}

export async function getAccount(apiKey: string): Promise<AccountInfo> {
  return request(`${BASE_URL}/api/account`, apiKey);
}

// --- Device Auth (RFC 8628) ---

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token?: string;
  token_type?: string;
  error?: string;
}

export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetch(`${BASE_URL}/auth/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error("Failed to start authentication");
  return res.json() as Promise<DeviceCodeResponse>;
}

export async function pollDeviceToken(
  deviceCode: string,
  intervalMs = 5000,
  timeoutMs = 900000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${BASE_URL}/auth/device/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    const data = (await res.json()) as DeviceTokenResponse;

    if (data.access_token) return data.access_token;
    if (data.error && data.error !== "authorization_pending") {
      throw new Error(`Authentication failed: ${data.error}`);
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Authentication timed out");
}
