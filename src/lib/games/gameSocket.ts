import { io, Socket } from 'socket.io-client';
import { auth } from '../firebase';
import { useAuthStore } from '../store';
import { getSocketServerUrl } from '../socketConfig';

let gameSocketInstance: Socket | null = null;
let currentSocketUrl: string | null = null;

export async function getGameSocket(): Promise<Socket | null> {
  const serverUrl = getSocketServerUrl();
  if (!serverUrl) {
    return null;
  }

  // If URL changed or socket disconnected/dead, recreate
  if (gameSocketInstance && currentSocketUrl === serverUrl) {
    if (!gameSocketInstance.connected) {
      gameSocketInstance.connect();
    }
    return gameSocketInstance;
  }

  if (gameSocketInstance) {
    gameSocketInstance.disconnect();
    gameSocketInstance = null;
  }

  currentSocketUrl = serverUrl;
  const currentUid = auth.currentUser?.uid || useAuthStore.getState().currentUser.id || 'guest';

  gameSocketInstance = io(serverUrl, {
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
    auth: async (callback) => {
      try {
        let token = '';
        if (auth.currentUser) {
          token = await auth.currentUser.getIdToken();
        } else {
          token = `demo-token-${currentUid}`;
        }
        callback({ token });
      } catch (err) {
        console.warn('[GameSocket] Auth token callback error:', err);
        callback({ token: `demo-token-${currentUid}` });
      }
    },
  });

  gameSocketInstance.on('connect', () => {
    console.log('[GameSocket] Connected to game server:', gameSocketInstance?.id);
  });

  gameSocketInstance.on('connect_error', (err) => {
    console.warn('[GameSocket] Connection error:', err.message);
  });

  return gameSocketInstance;
}
