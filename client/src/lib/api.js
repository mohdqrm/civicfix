// Every call to the backend goes through `api()`.
// - credentials: 'include' sends the httpOnly login cookie (JS can't read it, the browser just attaches it).
// - Errors from the server ({ error: { message, details } }) become an ApiError the UI can display,
//   including per-field messages for forms.
export class ApiError extends Error {
  constructor(status, message, details = [], code) {
    super(message);
    this.status = status;
    this.details = details;
    this.code = code;
  }
  /** { fieldName: 'message' } for showing errors under form inputs. */
  get fieldErrors() {
    return Object.fromEntries(this.details.map((d) => [d.field, d.message]));
  }
}

export async function api(path, { method = 'GET', body, query, signal } = {}) {
  let url = `/api${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += `?${qs}`;
  }
  const isForm = body instanceof FormData;
  let res;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      signal,
      headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError(0, 'Can’t reach CivicFix. Check your connection and try again.');
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error ?? {};
    throw new ApiError(res.status, e.message ?? `Request failed (${res.status})`, e.details ?? [], e.code);
  }
  return data;
}
