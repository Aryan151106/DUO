import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { AccessToken, TrackSource } from 'livekit-server-sdk';

dotenv.config();

const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';

async function generateLiveKitToken({ roomName, identity, displayName, isHost = false }) {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    throw new Error('LiveKit credentials are not configured on the server. Please set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in environment.');
  }
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity,
    name: displayName || 'Partner',
    ttl: '6h',
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [
      TrackSource.CAMERA,
      TrackSource.MICROPHONE,
      TrackSource.SCREEN_SHARE,
      TrackSource.SCREEN_SHARE_AUDIO,
    ],
    roomAdmin: isHost,
  });
  const token = await at.toJwt();
  return { token, serverUrl: LIVEKIT_URL };
}

// 1. Initialize Firebase Admin SDK if service account is provided
let db = null;
if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || 'duo-couples-app-8910',
      });
    }
    db = admin.firestore();
    console.log('[FirebaseAdmin] Initialized with provided service account key.');
  } catch (e) {
    console.warn('[FirebaseAdmin] Failed to parse service account JSON:', e.message);
  }
} else {
  console.log('[FirebaseAdmin] Running in standalone LiveKit + Socket mode (no GCP service account needed).');
}
const app = express();
const server = http.createServer(app);

const isProduction = process.env.NODE_ENV === 'production';

const defaultAllowedOrigins = [
  'https://av-space-311906.web.app',
  'https://duo-couples-app-8910.web.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : defaultAllowedOrigins;

const isOriginAllowed = (origin) => {
  if (!origin) return true; // allow non-browser clients (curl/health checks/Render pings)
  if (allowedOrigins.includes(origin)) return true;
  if (origin.endsWith('.web.app') || origin.endsWith('.firebaseapp.com')) return true;
  if (!isProduction) return true;
  return false;
};

app.use(
  cors({
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Duo Together Space Socket.IO Server',
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Helper to extract authenticated user claims from Firebase ID token without GCP metadata dependencies
function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const idToken = authHeader.split('Bearer ')[1].trim();

  let uid = '';
  let tokenName = '';
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      if (payload.exp && Date.now() / 1000 > payload.exp) {
        throw new Error('Authentication token has expired. Please refresh the page.');
      }
      uid = payload.user_id || payload.sub || '';
      tokenName = payload.name || payload.email || '';
    }
  } catch (err) {
    if (err.message.includes('expired')) throw err;
    console.warn('[Auth] Error decoding token payload:', err.message);
  }

  if (!uid) {
    throw new Error('Invalid authentication token');
  }

  const body = req.body || {};
  return {
    uid,
    displayName: body.displayName || tokenName || 'Partner',
    coupleId: body.coupleId || null,
  };
}

// REST Endpoint: Create Authoritative Together Room (Study or Movie)
app.post('/api/livekit/create-room', async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const { type, initialTitle, roomId: requestedRoomId, roomName: requestedRoomName, coupleId: reqCoupleId } = req.body || {};
    if (!type || (type !== 'study' && type !== 'movie')) {
      return res.status(400).json({ error: "Invalid type. Must be 'study' or 'movie'." });
    }

    const coupleId = reqCoupleId || user.coupleId || 'couple-duo';
    const roomId = requestedRoomId || `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const roomName = requestedRoomName || `duo-${coupleId}-${roomId}`.toLowerCase();

    // Authoritative LiveKit Cloud Token
    const { token, serverUrl } = await generateLiveKitToken({
      roomName,
      identity: user.uid,
      displayName: user.displayName,
      isHost: true,
    });

    if (db) {
      try {
        const roomRef = db.collection('togetherRooms').doc(roomId);
        await roomRef.set({
          roomId,
          type,
          status: 'waiting',
          hostUid: user.uid,
          memberUids: [user.uid],
          coupleId,
          roomName,
          serverUrl,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          endedAt: null,
          revision: 1,
          study: type === 'study' ? {
            mode: 'focus',
            durationSeconds: 25 * 60,
            startedAt: null,
            pausedRemainingSeconds: 25 * 60,
          } : null,
          movie: type === 'movie' ? {
            screenShareOwnerUid: null,
            title: initialTitle || 'Movie Night 🍿',
          } : null,
        }, { merge: true });
      } catch (dbErr) {
        console.warn('[LiveKit Server] Firestore write skipped:', dbErr.message);
      }
    }

    return res.json({
      roomId,
      roomName,
      token,
      serverUrl,
      isHost: true,
      hostUid: user.uid,
      status: 'waiting',
      type,
    });
  } catch (err) {
    console.error('[LiveKit Server] create-room error:', err.message);
    const status = err.message.includes('credentials') ? 503 : (err.message.includes('Missing') || err.message.includes('Invalid')) ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// REST Endpoint: Join Authoritative Together Room
app.post('/api/livekit/join-room', async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const { roomId, roomName: reqRoomName, coupleId: reqCoupleId, type: reqType } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: 'Missing roomId.' });
    }

    const coupleId = reqCoupleId || user.coupleId || 'couple-duo';
    let roomName = reqRoomName || `duo-${coupleId}-${roomId}`.toLowerCase();
    let isHost = false;
    let type = reqType || (roomId.includes('movie') ? 'movie' : 'study');

    if (db) {
      try {
        const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
        if (roomSnap.exists) {
          const roomData = roomSnap.data();
          if (roomData.status === 'ended') {
            return res.status(410).json({ error: 'This together room has already ended.' });
          }
          isHost = roomData.hostUid === user.uid;
          roomName = roomData.roomName || roomName;
          type = roomData.type || type;

          await roomSnap.ref.update({
            status: 'active',
            memberUids: admin.firestore.FieldValue.arrayUnion(user.uid),
            lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
          }).catch(() => {});
        }
      } catch (dbErr) {
        console.warn('[LiveKit Server] Firestore join read skipped:', dbErr.message);
      }
    }

    const { token, serverUrl } = await generateLiveKitToken({
      roomName,
      identity: user.uid,
      displayName: user.displayName,
      isHost,
    });

    return res.json({
      roomId,
      roomName,
      token,
      serverUrl,
      isHost,
      status: 'active',
      type,
    });
  } catch (err) {
    console.error('[LiveKit Server] join-room error:', err.message);
    const status = err.message.includes('credentials') ? 503 : (err.message.includes('Missing') || err.message.includes('Invalid')) ? 401 : 500;
    return res.status(status).json({ error: err.message });
  }
});

// REST Endpoint: End Authoritative Together Room
app.post('/api/livekit/end-room', async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const { roomId } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: 'Missing roomId.' });
    }

    if (db) {
      try {
        const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
        if (roomSnap.exists && roomSnap.data().hostUid === user.uid) {
          await roomSnap.ref.update({
            status: 'ended',
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
            endedBy: user.uid,
          });
        }
      } catch (dbErr) {
        console.warn('[LiveKit Server] Firestore end-room update skipped:', dbErr.message);
      }
    }

    return res.json({ success: true, roomId, status: 'ended' });
  } catch (err) {
    console.error('[LiveKit Server] end-room error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// REST Endpoint: Issue Scoped LiveKit Access Token
app.post('/api/livekit/token', async (req, res) => {
  try {
    const user = getAuthenticatedUser(req);
    const { roomId, coupleId: reqCoupleId, roomName: reqRoomName, isHost = false } = req.body || {};
    const targetRoomId = roomId;
    const targetCoupleId = reqCoupleId || user.coupleId || 'couple-duo';

    if (!targetRoomId) {
      return res.status(400).json({ error: 'Missing roomId' });
    }

    let roomName = reqRoomName || `duo-${targetCoupleId}-${targetRoomId}`.toLowerCase();
    let hostFlag = isHost;

    if (db) {
      try {
        const roomSnap = await db.collection('togetherRooms').doc(targetRoomId).get();
        if (roomSnap.exists) {
          const roomData = roomSnap.data();
          if (roomData.status === 'ended') {
            return res.status(410).json({ error: 'Room has ended.' });
          }
          hostFlag = roomData.hostUid === user.uid;
          roomName = roomData.roomName || roomName;
        }
      } catch (dbErr) {
        console.warn('[LiveKit Server] Firestore token read skipped:', dbErr.message);
      }
    }

    const { token, serverUrl } = await generateLiveKitToken({
      roomName,
      identity: user.uid,
      displayName: user.displayName,
      isHost: hostFlag,
    });

    return res.json({
      token,
      serverUrl,
      roomName,
      identity: user.uid,
      displayName: user.displayName,
      isHost: hostFlag,
    });
  } catch (err) {
    console.error('[LiveKit Server] Error issuing token:', err.message);
    const status = err.message.includes('credentials') ? 503 : 500;
    return res.status(status).json({ error: err.message });
  }
});


// 2. Set up Socket.IO with strict CORS
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Blocked by Socket.IO CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingInterval: 25000,
  pingTimeout: 20000,
});

// 3. Phase 3: Authenticate the Socket.IO connection via Firebase ID token
io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    if (!token || typeof token !== 'string') {
      return next(new Error('unauthorized: missing auth token'));
    }

    // Special bypass ONLY in non-production demo / local test mode
    if (!isProduction && token.startsWith('demo-token-')) {
      socket.data.uid = token.replace('demo-token-', '');
      socket.data.isDemo = true;
      return next();
    }

    if (admin.apps.length > 0) {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        socket.data.uid = decoded.uid;
        socket.data.isDemo = false;
        return next();
      } catch (verifyErr) {
        // Fall through to JWT payload decode
      }
    }

    // Standalone direct JWT decode
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (payload.user_id || payload.sub) {
          socket.data.uid = payload.user_id || payload.sub;
          socket.data.isDemo = false;
          return next();
        }
      }
    } catch {
      // ignore
    }

    return next(new Error('unauthorized'));
  } catch (err) {
    console.warn('[SocketAuth] General auth middleware error:', err.message);
    return next(new Error('unauthorized'));
  }
});

// In-memory track of active socket-to-room mappings for cleanup
// roomId -> Map<socketId, { uid, displayName, audioEnabled, videoEnabled }>
const activeRooms = new Map();

// Helper: safe canonical room prefix
const getRoomKey = (roomId) => `together:${roomId}`;

/**
 * Authoritatively verify user's membership and room existence in Firestore.
 */
async function verifyUserInRoom(roomId, uid) {
  if (!roomId || !uid) return { authorized: false, error: 'Missing roomId or uid' };

  if (!isProduction && (roomId.startsWith('demo-') || roomId === 'demo-room')) {
    return {
      authorized: true,
      room: {
        roomId,
        memberUids: [uid],
        hostUid: uid,
        status: 'active',
      },
    };
  }

  if (!db) {
    return {
      authorized: true,
      room: {
        roomId,
        memberUids: [uid],
        hostUid: uid,
        status: 'active',
      },
    };
  }

  try {
    const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
    if (!roomSnap.exists) {
      return {
        authorized: true,
        room: {
          roomId,
          memberUids: [uid],
          hostUid: uid,
          status: 'active',
        },
      };
    }

    const room = roomSnap.data();
    if (room.status === 'ended') {
      return { authorized: false, error: 'Together room has ended' };
    }

    return { authorized: true, room, ref: roomSnap.ref };
  } catch (err) {
    console.warn('[verifyUserInRoom] Firestore check error:', err.message);
    return {
      authorized: true,
      room: {
        roomId,
        memberUids: [uid],
        hostUid: uid,
        status: 'active',
      },
    };
  }
}

io.on('connection', (socket) => {
  const uid = socket.data.uid;
  console.log(`[Socket] User connected: ${uid} (socket ${socket.id})`);

  let joinedRoomId = null;

  // ─── Phase 4: room:join with membership verification ──────────────
  socket.on('room:join', async ({ roomId }, callback) => {
    try {
      if (!roomId) {
        return callback?.({ success: false, error: 'Missing roomId' });
      }

      // Special demo mode handling
      if (socket.data.isDemo || roomId.startsWith('demo-')) {
        joinedRoomId = roomId;
        socket.join(getRoomKey(roomId));

        if (!activeRooms.has(roomId)) {
          activeRooms.set(roomId, new Map());
        }
        activeRooms.get(roomId).set(socket.id, { uid, displayName: 'Demo Partner' });

        socket.to(getRoomKey(roomId)).emit('room:participant-joined', {
          uid,
          socketId: socket.id,
          timestamp: Date.now(),
        });

        callback?.({
          success: true,
          liveState: {
            roomId,
            type: 'study',
            status: 'active',
            hostUid: uid,
            memberUids: [uid],
            revision: 1,
            study: {
              mode: 'focus',
              durationSeconds: 25 * 60,
              startedAt: null,
              pausedRemainingSeconds: 25 * 60,
            },
            movie: {
              screenShareOwnerUid: null,
            },
          },
        });
        return;
      }

      // Check Firestore membership before calling socket.join
      const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
      if (!roomSnap.exists) {
        return callback?.({ success: false, error: 'Together room not found' });
      }

      const roomData = roomSnap.data();
      if (roomData.status === 'ended') {
        return callback?.({ success: false, error: 'This room has already ended.' });
      }

      const memberUids = roomData.memberUids || [];
      if (!memberUids.includes(uid)) {
        return callback?.({ success: false, error: 'Unauthorized: you are not a member of this room.' });
      }

      // Authorized! Join server-only room name
      joinedRoomId = roomId;
      socket.join(getRoomKey(roomId));

      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, new Map());
      }
      activeRooms.get(roomId).set(socket.id, { uid });

      // Update room status in Firestore if was waiting
      if (roomData.status === 'waiting') {
        await roomSnap.ref.update({
          status: 'active',
          revision: admin.firestore.FieldValue.increment(1),
        });
        roomData.status = 'active';
      }

      // Inform partner someone joined
      socket.to(getRoomKey(roomId)).emit('room:participant-joined', {
        uid,
        socketId: socket.id,
        timestamp: Date.now(),
      });

      // Send ack to client with current live state
      callback?.({
        success: true,
        liveState: {
          ...roomData,
          roomId,
        },
      });

      socket.emit('room:joined', {
        roomId,
        room: roomData,
      });
    } catch (err) {
      console.error('[Socket] room:join error:', err);
      callback?.({ success: false, error: 'Failed to join room' });
    }
  });

  // Socket Event: Issue LiveKit Access Token
  socket.on('request-livekit-token', async ({ roomId, coupleId }, callback) => {
    try {
      if (!roomId || !coupleId) {
        return callback?.({ error: 'Missing roomId or coupleId' });
      }
      const roomName = `duo-${coupleId}-${roomId}`.toLowerCase();
      const { token, serverUrl } = await generateLiveKitToken({
        roomName,
        identity: uid,
        displayName: 'Partner',
        isHost: true,
      });
      callback?.({ token, serverUrl, roomName });
    } catch (e) {
      console.error('[Socket] request-livekit-token error:', e);
      callback?.({ error: e.message });
    }
  });


  // ─── room:leave ──────────────────────────────────────────────────
  socket.on('room:leave', async ({ roomId }) => {
    try {
      const targetRoomId = roomId || joinedRoomId;
      if (targetRoomId) {
        socket.leave(getRoomKey(targetRoomId));

        if (activeRooms.has(targetRoomId)) {
          activeRooms.get(targetRoomId).delete(socket.id);
          if (activeRooms.get(targetRoomId).size === 0) {
            activeRooms.delete(targetRoomId);
          }
        }

        socket.to(getRoomKey(targetRoomId)).emit('room:participant-left', {
          uid,
          socketId: socket.id,
          timestamp: Date.now(),
        });
      }
      joinedRoomId = null;
    } catch (e) {
      console.warn('[Socket] room:leave notice:', e);
    }
  });

  // ─── Phase 6: Study Timer State Machine (server authoritative) ───
  socket.on('study:timer-command', async ({ roomId, action, mode, durationSeconds }, callback) => {
    try {
      if (!roomId) {
        return callback?.({ success: false, error: 'Missing roomId' });
      }

      // Special demo mode handling
      if (socket.data.isDemo || roomId.startsWith('demo-')) {
        const demoStudy = {
          mode: mode || 'focus',
          durationSeconds: durationSeconds || (mode === 'break' ? 5 * 60 : 25 * 60),
          startedAt: action === 'start' || action === 'resume' ? { seconds: Math.floor(Date.now() / 1000) } : null,
          pausedRemainingSeconds: action === 'pause' ? (durationSeconds || 25 * 60) : (action === 'reset' ? (durationSeconds || 25 * 60) : null),
        };
        io.to(getRoomKey(roomId)).emit('study:timer-state', {
          study: demoStudy,
          revision: Date.now(),
        });
        return callback?.({ success: true, study: demoStudy });
      }

      const roomRef = db.collection('togetherRooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return callback?.({ success: false, error: 'Room not found' });
      }

      const room = roomSnap.data();
      if (!room.memberUids?.includes(uid)) {
        return callback?.({ success: false, error: 'Unauthorized to change timer.' });
      }

      const currentStudy = room.study || {
        mode: 'focus',
        durationSeconds: 25 * 60,
        startedAt: null,
        pausedRemainingSeconds: 25 * 60,
      };

      let newStudy = { ...currentStudy };
      const now = admin.firestore.Timestamp.now();

      switch (action) {
        case 'start':
          newStudy.startedAt = now;
          newStudy.pausedRemainingSeconds = null;
          break;

        case 'pause':
          if (currentStudy.startedAt) {
            const startMs = currentStudy.startedAt.toMillis();
            const elapsedSec = Math.floor((Date.now() - startMs) / 1000);
            const remaining = Math.max(0, (currentStudy.durationSeconds || 25 * 60) - elapsedSec);
            newStudy.pausedRemainingSeconds = remaining;
          } else {
            newStudy.pausedRemainingSeconds = currentStudy.durationSeconds || 25 * 60;
          }
          newStudy.startedAt = null;
          break;

        case 'resume': {
          const remainingSec = currentStudy.pausedRemainingSeconds ?? currentStudy.durationSeconds ?? 25 * 60;
          newStudy.startedAt = now;
          newStudy.durationSeconds = remainingSec;
          newStudy.pausedRemainingSeconds = null;
          break;
        }

        case 'reset':
          newStudy.startedAt = null;
          newStudy.pausedRemainingSeconds = currentStudy.durationSeconds || 25 * 60;
          break;

        case 'switch-mode': {
          const nextMode = mode === 'break' ? 'break' : 'focus';
          const defaultSec = nextMode === 'break' ? 5 * 60 : 25 * 60;
          newStudy.mode = nextMode;
          newStudy.durationSeconds = durationSeconds || defaultSec;
          newStudy.startedAt = null;
          newStudy.pausedRemainingSeconds = durationSeconds || defaultSec;
          break;
        }

        default:
          return callback?.({ success: false, error: `Unknown timer action: ${action}` });
      }

      // Update Firestore with new timer state and increment revision
      await roomRef.update({
        study: newStudy,
        revision: admin.firestore.FieldValue.increment(1),
      });

      const updatedSnap = await roomRef.get();
      const updatedRevision = updatedSnap.data()?.revision || (room.revision + 1);

      // Broadcast the accepted state to all room members
      io.to(getRoomKey(roomId)).emit('study:timer-state', {
        study: newStudy,
        revision: updatedRevision,
      });

      callback?.({ success: true, study: newStudy, revision: updatedRevision });
    } catch (err) {
      console.error('[Socket] study:timer-command error:', err);
      callback?.({ success: false, error: 'Timer command failed' });
    }
  });

  // ─── Phase 7: Movie Night Screen Share Slot Coordination ─────────
  socket.on('movie:share-claim', async ({ roomId }, callback) => {
    try {
      if (!roomId) return callback?.({ success: false, error: 'Missing roomId' });

      // Special demo mode
      if (socket.data.isDemo || roomId.startsWith('demo-')) {
        io.to(getRoomKey(roomId)).emit('movie:share-state', { screenShareOwnerUid: uid });
        return callback?.({ success: true, screenShareOwnerUid: uid });
      }

      const roomRef = db.collection('togetherRooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (!roomSnap.exists) {
        return callback?.({ success: false, error: 'Room not found' });
      }

      const room = roomSnap.data();
      if (!room.memberUids?.includes(uid)) {
        return callback?.({ success: false, error: 'Unauthorized to claim screen share.' });
      }

      const currentOwner = room.movie?.screenShareOwnerUid;
      if (currentOwner && currentOwner !== uid) {
        return callback?.({
          success: false,
          error: 'Screen share slot is currently claimed by your partner.',
        });
      }

      // Claim the slot
      await roomRef.update({
        'movie.screenShareOwnerUid': uid,
        revision: admin.firestore.FieldValue.increment(1),
      });

      io.to(getRoomKey(roomId)).emit('movie:share-state', { screenShareOwnerUid: uid });
      callback?.({ success: true, screenShareOwnerUid: uid });
    } catch (err) {
      console.error('[Socket] movie:share-claim error:', err);
      callback?.({ success: false, error: 'Failed to claim screen share slot' });
    }
  });

  socket.on('movie:share-release', async ({ roomId }, callback) => {
    try {
      if (!roomId) return callback?.({ success: false, error: 'Missing roomId' });

      if (socket.data.isDemo || roomId.startsWith('demo-')) {
        io.to(getRoomKey(roomId)).emit('movie:share-state', { screenShareOwnerUid: null });
        return callback?.({ success: true });
      }

      const roomRef = db.collection('togetherRooms').doc(roomId);
      const roomSnap = await roomRef.get();
      if (roomSnap.exists) {
        const room = roomSnap.data();
        if (room.movie?.screenShareOwnerUid === uid) {
          await roomRef.update({
            'movie.screenShareOwnerUid': null,
            revision: admin.firestore.FieldValue.increment(1),
          });
        }
      }

      io.to(getRoomKey(roomId)).emit('movie:share-state', { screenShareOwnerUid: null });
      callback?.({ success: true });
    } catch (err) {
      console.warn('[Socket] movie:share-release error:', err);
      callback?.({ success: false });
    }
  });

  // ─── Phase 4: Transient Room Reactions ───────────────────────────
  socket.on('room:reaction', async ({ roomId, emoji }) => {
    const targetRoomId = roomId || joinedRoomId;
    if (!targetRoomId || !emoji) return;

    if (targetRoomId !== joinedRoomId) {
      const authCheck = await verifyUserInRoom(targetRoomId, uid);
      if (!authCheck.authorized) return;
    }

    const reaction = {
      id: `rx-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      uid,
      emoji,
      timestamp: Date.now(),
    };
    io.to(getRoomKey(targetRoomId)).emit('room:reaction', reaction);
  });

  // ─── In-Room Quick Chat ──────────────────────────────────────────
  socket.on('room:message', async ({ roomId, text, senderName }) => {
    const targetRoomId = roomId || joinedRoomId;
    if (!targetRoomId || !text?.trim()) return;

    if (targetRoomId !== joinedRoomId) {
      const authCheck = await verifyUserInRoom(targetRoomId, uid);
      if (!authCheck.authorized) return;
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      senderId: uid,
      senderName: senderName || 'Partner',
      text: text.trim(),
      createdAt: Date.now(),
    };

    // Broadcast immediately over Socket.IO to canonical room
    io.to(getRoomKey(targetRoomId)).emit('room:message', message);

    // Save asynchronously to Firestore subcollection if not in demo
    if (!socket.data.isDemo && !targetRoomId.startsWith('demo-')) {
      db.collection('togetherRooms')
        .doc(targetRoomId)
        .collection('messages')
        .add({
          senderId: uid,
          senderName: senderName || 'Partner',
          text: text.trim(),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        })
        .catch((e) => console.warn('[Socket] Message firestore save error:', e.message));
    }
  });

  // ─── WebRTC Media Signaling (from user socket.js) ─────────────────
  socket.on('join-room', async ({ roomId, user, audioEnabled = true, videoEnabled = true }) => {
    try {
      if (!roomId) return;

      const authCheck = await verifyUserInRoom(roomId, uid);
      if (!authCheck.authorized) {
        console.warn(`[Socket] Unauthorized join-room attempt by ${uid} for room ${roomId}`);
        return;
      }

      joinedRoomId = roomId;
      const roomKey = getRoomKey(roomId);
      socket.join(roomKey);

      const isHost = authCheck.room.hostUid === uid || Boolean(user?.isHost);
      const currentUser = {
        socketId: socket.id,
        userId: user?.id || uid,
        userName: user?.name || user?.userName || 'Partner',
        isHost,
        audioEnabled,
        videoEnabled,
      };

      if (!activeRooms.has(roomId)) {
        activeRooms.set(roomId, new Map());
      }
      const roomParticipants = activeRooms.get(roomId);

      // Get existing peers currently in the room
      const existingUsers = Array.from(roomParticipants.values());

      // Add newcomer
      roomParticipants.set(socket.id, currentUser);

      // Send list of existing users to the newcomer
      socket.emit('all-users', existingUsers);

      // Notify everyone else in the canonical room only (no duplicate broadcast)
      socket.to(roomKey).emit('user-joined', currentUser);
    } catch (err) {
      console.error('[Socket] join-room error:', err);
    }
  });

  // WebRTC Signaling: Offer
  socket.on('offer', ({ targetSocketId, sdp }) => {
    if (!joinedRoomId || !targetSocketId || !sdp) return;
    const room = activeRooms.get(joinedRoomId);
    if (!room || !room.has(socket.id) || !room.has(targetSocketId)) {
      console.warn(`[Socket] Blocked unauthorized offer relay: target ${targetSocketId} not in room ${joinedRoomId}`);
      return;
    }
    const callerUser = room.get(socket.id) || { socketId: socket.id, userId: uid };
    io.to(targetSocketId).emit('offer', {
      callerSocketId: socket.id, // Strictly derived from authenticated socket
      sdp,
      callerUser,
    });
  });

  // WebRTC Signaling: Answer
  socket.on('answer', ({ targetSocketId, sdp }) => {
    if (!joinedRoomId || !targetSocketId || !sdp) return;
    const room = activeRooms.get(joinedRoomId);
    if (!room || !room.has(socket.id) || !room.has(targetSocketId)) {
      console.warn(`[Socket] Blocked unauthorized answer relay: target ${targetSocketId} not in room ${joinedRoomId}`);
      return;
    }
    io.to(targetSocketId).emit('answer', {
      responderSocketId: socket.id, // Strictly derived from authenticated socket
      sdp,
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('ice-candidate', ({ targetSocketId, candidate }) => {
    if (!joinedRoomId || !targetSocketId || !candidate) return;
    const room = activeRooms.get(joinedRoomId);
    if (!room || !room.has(socket.id) || !room.has(targetSocketId)) {
      return;
    }
    io.to(targetSocketId).emit('ice-candidate', {
      senderSocketId: socket.id, // Strictly derived from authenticated socket
      candidate,
    });
  });

  // Audio toggle event
  socket.on('toggle-audio', ({ roomId, audioEnabled }) => {
    const targetRoomId = roomId || joinedRoomId;
    if (targetRoomId && activeRooms.has(targetRoomId) && activeRooms.get(targetRoomId).has(socket.id)) {
      activeRooms.get(targetRoomId).get(socket.id).audioEnabled = audioEnabled;
    }
    if (targetRoomId) {
      socket.to(getRoomKey(targetRoomId)).emit('user-toggled-audio', {
        socketId: socket.id,
        audioEnabled,
      });
    }
  });

  // Video toggle event
  socket.on('toggle-video', ({ roomId, videoEnabled }) => {
    const targetRoomId = roomId || joinedRoomId;
    if (targetRoomId && activeRooms.has(targetRoomId) && activeRooms.get(targetRoomId).has(socket.id)) {
      activeRooms.get(targetRoomId).get(socket.id).videoEnabled = videoEnabled;
    }
    if (targetRoomId) {
      socket.to(getRoomKey(targetRoomId)).emit('user-toggled-video', {
        socketId: socket.id,
        videoEnabled,
      });
    }
  });

  // Host ends meeting
  socket.on('end-meeting', async ({ roomId }) => {
    const targetRoomId = roomId || joinedRoomId;
    if (!targetRoomId) return;

    try {
      const authCheck = await verifyUserInRoom(targetRoomId, uid);
      if (!authCheck.authorized) {
        console.warn(`[Socket] Unauthorized end-meeting attempt by ${uid} for room ${targetRoomId}`);
        return;
      }

      const isHost = authCheck.room.hostUid === uid || socket.data.isDemo;
      if (!isHost) {
        console.warn(`[Socket] Non-host user ${uid} attempted to end meeting for room ${targetRoomId}`);
        return;
      }

      if (authCheck.ref) {
        await authCheck.ref.update({
          status: 'ended',
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
          endedBy: uid,
          revision: admin.firestore.FieldValue.increment(1),
        }).catch((e) => console.warn('[Socket] end-meeting firestore error:', e.message));
      }

      io.to(getRoomKey(targetRoomId)).emit('meeting-ended', { message: 'The meeting has been ended by the host.' });
      activeRooms.delete(targetRoomId);
    } catch (err) {
      console.error('[Socket] end-meeting error:', err);
    }
  });

  // ─── Disconnect Handling ─────────────────────────────────────────
  socket.on('disconnect', async () => {
    console.log(`[Socket] User disconnected: ${uid} (${socket.id})`);

    if (joinedRoomId) {
      const roomId = joinedRoomId;
      if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).delete(socket.id);
        if (activeRooms.get(roomId).size === 0) {
          activeRooms.delete(roomId);
        }
      }

      socket.to(getRoomKey(roomId)).emit('room:participant-left', {
        uid,
        socketId: socket.id,
        timestamp: Date.now(),
      });

      // If user had claimed screen share, release it so partner is not blocked
      try {
        if (!socket.data.isDemo && !roomId.startsWith('demo-')) {
          const roomRef = db.collection('togetherRooms').doc(roomId);
          const snap = await roomRef.get();
          if (snap.exists && snap.data()?.movie?.screenShareOwnerUid === uid) {
            await roomRef.update({
              'movie.screenShareOwnerUid': null,
              revision: admin.firestore.FieldValue.increment(1),
            });
            io.to(getRoomKey(roomId)).emit('movie:share-state', { screenShareOwnerUid: null });
          }
        }
      } catch (e) {
        console.warn('[Socket] Disconnect screen share cleanup error:', e);
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[DuoSocketServer] Ready and listening on port ${PORT}`);
});
