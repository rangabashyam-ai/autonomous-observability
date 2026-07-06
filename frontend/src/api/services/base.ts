const BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';
const VM_BASE = import.meta.env.VITE_VM_API_BASE_URL ?? '/api/vm';

export { BASE, VM_BASE };

export async function fetchJson<T>(
  url: string,
  options?: RequestInit,
  timeoutMs = 20_000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `API error: ${res.status}`);
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
