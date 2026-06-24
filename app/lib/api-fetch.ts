// Server-side fetch to the data API. On Cloud Run it attaches a GCP identity
// token (from the metadata server) for the target audience; in local dev it's a
// plain fetch with no auth.

const API_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

// GCP identity tokens last 1 hour; cache with a 55-minute TTL.
let cachedToken: string | null = null;
let tokenFetchedAt = 0;
const TOKEN_TTL_MS = 55 * 60 * 1000;

function isLocalDev(): boolean {
  return !API_URL || API_URL.includes('localhost') || API_URL.includes('127.0.0.1');
}

async function getIdentityToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedToken && now - tokenFetchedAt < TOKEN_TTL_MS) return cachedToken;

  try {
    const metadataUrl =
      'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
      `?audience=${encodeURIComponent(API_URL)}&format=full`;
    const res = await fetch(metadataUrl, {
      headers: { 'Metadata-Flavor': 'Google' },
      signal: AbortSignal.timeout(3000), // fail fast if the metadata server is absent
    });
    if (!res.ok) return null;

    const token = (await res.text()).trim();
    if (!token) return null;

    cachedToken = token;
    tokenFetchedAt = now;
    return token;
  } catch {
    return null;
  }
}

// Fetch from the data API with an identity token when on Cloud Run; plain fetch locally.
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_URL}${path}`;
  if (isLocalDev()) return fetch(url, init);

  const token = await getIdentityToken();
  if (!token) return fetch(url, init); // metadata server unavailable, will likely 403

  return fetch(url, {
    ...init,
    headers: { ...(init?.headers ?? {}), Authorization: `Bearer ${token}` },
  });
}
