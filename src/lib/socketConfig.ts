/**
 * socketConfig.ts
 * Centralized Socket.IO server URL resolver for Duo Together Space.
 * Ensures consistent connectivity whether running on localhost, 127.0.0.1,
 * LAN IP (phone testing), or custom cloud deployment.
 */

// Auto-purge insecure or invalid socket URL stored in localStorage from prior sessions
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem('duo_socket_url');
    if (stored) {
      const lower = stored.toLowerCase();
      if (
        (window.location.protocol === 'https:' && lower.startsWith('http://')) ||
        lower.includes('web.app') ||
        lower.includes('firebaseapp.com') ||
        (window.location.protocol === 'https:' && lower.includes(':3001'))
      ) {
        console.info('[SocketConfig] Auto-purged incompatible socket URL:', stored);
        localStorage.removeItem('duo_socket_url');
      }
    }
  } catch {}
}

export function getSocketServerUrl(): string {
  if (typeof window !== 'undefined') {
    const isHttps = window.location.protocol === 'https:';

    // 1. User-configured override in localStorage (e.g., custom deployed socket server on Render/Railway)
    const custom = localStorage.getItem('duo_socket_url');
    if (custom && custom.trim() !== '') {
      const trimmed = custom.trim().replace(/\/+$/, '');
      const lower = trimmed.toLowerCase();

      // If we are on HTTPS, disallow ANY http:// URL (causes Mixed Content browser security blocks)
      if (isHttps && lower.startsWith('http://')) {
        try { localStorage.removeItem('duo_socket_url'); } catch {}
        return '';
      }

      // Disallow Firebase Hosting domains (Firebase Hosting cannot run Socket.IO / custom WebSocket listeners)
      if (lower.includes('web.app') || lower.includes('firebaseapp.com') || (isHttps && lower.includes(':3001'))) {
        try { localStorage.removeItem('duo_socket_url'); } catch {}
        return '';
      }

      // When deployed to production HTTPS, localhost is unreachable
      if (isHttps && (lower.includes('localhost') || lower.includes('127.0.0.1'))) {
        return '';
      }

      return trimmed;
    }

    // 2. Explicit Vite environment variable
    const envUrl = (import.meta as any).env?.VITE_SOCKET_SERVER_URL;
    if (envUrl && typeof envUrl === 'string' && envUrl.trim() !== '') {
      const trimmed = envUrl.trim().replace(/\/+$/, '');
      const lower = trimmed.toLowerCase();

      // When deployed to production HTTPS, disallow http:// and localhost
      if (isHttps && (lower.startsWith('http://') || lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('web.app'))) {
        return '';
      }
      return trimmed;
    }

    const { hostname, port } = window.location;

    // 3. Local development detection (ONLY when running over HTTP locally)
    const isLocalDevHost =
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.16.') ||
      hostname.startsWith('172.17.') ||
      hostname.startsWith('172.18.') ||
      hostname.startsWith('172.19.') ||
      hostname.startsWith('172.2') ||
      hostname.startsWith('172.3') ||
      hostname.endsWith('.local') ||
      Boolean(port && port !== '80' && port !== '443');

    if (isLocalDevHost && !isHttps) {
      // Connect to the local Node.js socket server on port 3001 matching the current hostname
      return `http://${hostname}:3001`;
    }

    // 4. In production HTTPS environments, do NOT point to Firebase Hosting domain (it cannot serve WebSockets).
    // Returning empty string directs the client to use built-in WebRTC CallRoom seamlessly.
    return '';
  }

  return '';
}

export function isSocketServerConfigured(): boolean {
  const url = getSocketServerUrl();
  return Boolean(url && url.trim().length > 0);
}

export function setCustomSocketServerUrl(url: string) {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('duo_socket_url', url.trim().replace(/\/+$/, ''));
    } else {
      localStorage.removeItem('duo_socket_url');
    }
  }
}

