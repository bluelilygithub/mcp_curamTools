/**
 * API client — centralised fetch wrapper.
 * - Auto-adds Authorization: Bearer token from authStore.
 * - Handles 401 globally: clears auth state and redirects to /login.
 * - Never use raw fetch('/api/...') for authenticated endpoints.
 */
import useAuthStore from '../stores/authStore';

const BASE = '/api';

async function request(path, options = {}) {
  const token = useAuthStore.getState().token;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers ?? {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    useAuthStore.getState().clearAuth();
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      message = body.error || body.message || message;
    } catch {
      // use default message
    }
    throw new Error(message);
  }

  const contentType = res.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    return res.json();
  }
  return res;
}

const api = {
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options = {}) =>
    request(path, { ...options, method: 'POST', body: JSON.stringify(body) }),
  put: (path, body, options = {}) =>
    request(path, { ...options, method: 'PUT', body: JSON.stringify(body) }),
  patch: (path, body, options = {}) =>
    request(path, { ...options, method: 'PATCH', body: JSON.stringify(body) }),
  delete: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),

  /**
   * Upload a file via multipart/form-data POST.
   * Omits Content-Type so the browser sets the correct boundary.
   */
  upload: async (path, formData) => {
    const token = useAuthStore.getState().token;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}${path}`, { method: 'POST', headers, body: formData });
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Session expired.');
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { const body = await res.json(); message = body.error || body.message || message; } catch {}
      throw new Error(message);
    }
    return res.json();
  },

  /**
   * Upload via XHR so upload progress can be tracked.
   * onProgress(fraction) is called with 0–1 during the upload phase.
   * After upload completes the server processes the file — no further progress events.
   */
  uploadWithProgress: (path, formData, onProgress) => {
    return new Promise((resolve, reject) => {
      const token = useAuthStore.getState().token;
      const xhr   = new XMLHttpRequest();
      xhr.open('POST', `${BASE}${path}`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
        // Signal upload complete (server side now processing)
        xhr.upload.onload = () => onProgress(1);
      }

      xhr.onload = () => {
        if (xhr.status === 401) {
          useAuthStore.getState().clearAuth();
          window.location.href = '/login';
          reject(new Error('Session expired.'));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          let message = `HTTP ${xhr.status}`;
          try {
            const body = JSON.parse(xhr.responseText);
            message = body.error || body.message || message;
          } catch {}
          reject(new Error(message));
          return;
        }
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { reject(new Error('Invalid response from server')); }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send(formData);
    });
  },

  /**
   * Open a streaming SSE connection via POST.
   * Returns the raw fetch Response — caller reads the ReadableStream.
   */
  stream: async (path, body) => {
    const token = useAuthStore.getState().token;
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      useAuthStore.getState().clearAuth();
      window.location.href = '/login';
      throw new Error('Session expired.');
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body.error || body.message || message;
      } catch { /* use default */ }
      throw new Error(message);
    }
    return res;
  },
};

export default api;
