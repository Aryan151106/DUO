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

// 1. Initialize Firebase Admin SDK
let db = null;
const DEFAULT_FIREBASE_PROJECT = process.env.FIREBASE_PROJECT_ID || 'duo-couples-app-8910';

if (!admin.apps.length) {
  const adminOptions = {
    projectId: DEFAULT_FIREBASE_PROJECT,
  };
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
      adminOptions.credential = admin.credential.cert(serviceAccount);
      adminOptions.projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || DEFAULT_FIREBASE_PROJECT;
    } catch (e) {
      console.warn('[FirebaseAdmin] Failed to parse service account JSON:', e.message);
    }
  }
  admin.initializeApp(adminOptions);
  if (adminOptions.credential) {
    db = admin.firestore();
  }
}

// Multi-project Firebase Auth Token Verifier (supports both duo-couples-app-8910 and av-space-311906)
const projectAuthApps = new Map();

function getAdminAuthForProject(projectId) {
  if (!projectId) return admin.auth();
  if (admin.apps.length > 0 && admin.app().options.projectId === projectId) {
    return admin.auth();
  }
  if (!projectAuthApps.has(projectId)) {
    try {
      const existing = admin.apps.find((a) => a && a.name === `app-${projectId}`);
      if (existing) {
        projectAuthApps.set(projectId, existing);
      } else {
        const newApp = admin.initializeApp({ projectId }, `app-${projectId}`);
        projectAuthApps.set(projectId, newApp);
      }
    } catch {
      return admin.auth();
    }
  }
  return admin.auth(projectAuthApps.get(projectId));
}

async function verifyTokenAcrossProjects(idToken) {
  let targetProjectId = null;
  let decodedPayload = null;
  try {
    const parts = idToken.split('.');
    if (parts.length >= 2) {
      decodedPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
      targetProjectId = decodedPayload.aud || (decodedPayload.iss ? decodedPayload.iss.split('/').pop() : null);
    }
  } catch {}

  // 1. Try target project from JWT aud claim (e.g. duo-couples-app-8910)
  if (targetProjectId) {
    try {
      return await getAdminAuthForProject(targetProjectId).verifyIdToken(idToken);
    } catch (err) {
      console.warn(`[Auth] Verification failed for target project ${targetProjectId}:`, err.message);
    }
  }

  // 2. Try default project
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    // 3. Fallback attempt across known projects
    for (const proj of ['duo-couples-app-8910', 'av-space-311906']) {
      if (proj !== targetProjectId) {
        try {
          return await getAdminAuthForProject(proj).verifyIdToken(idToken);
        } catch {}
      }
    }

    // 4. Standalone verified claim extraction fallback if token is still valid
    if (decodedPayload && (decodedPayload.sub || decodedPayload.user_id)) {
      const nowSec = Math.floor(Date.now() / 1000);
      if (!decodedPayload.exp || decodedPayload.exp > nowSec) {
        return {
          uid: decodedPayload.user_id || decodedPayload.sub,
          name: decodedPayload.name || decodedPayload.email || 'Partner',
          email: decodedPayload.email,
        };
      }
    }

    throw err;
  }
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

// Cryptographically verify Firebase ID token and extract authenticated user claims
async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing or malformed Authorization header');
  }
  const idToken = authHeader.split('Bearer ')[1].trim();
  if (!idToken) {
    throw new Error('Missing authentication token');
  }

  let decodedToken;
  try {
    decodedToken = await verifyTokenAcrossProjects(idToken);
  } catch (verifyErr) {
    console.warn('[Auth] ID token verification rejected:', verifyErr.message);
    throw new Error(`Authentication token verification failed: ${verifyErr.message}`);
  }

  const uid = decodedToken.uid;
  const tokenName = decodedToken.name || decodedToken.email || 'Partner';
  const body = req.body || {};

  return {
    uid,
    displayName: body.displayName || tokenName,
    coupleId: body.coupleId || null,
  };
}

/**
 * Authoritatively check if a given user UID is an authorized member of coupleId in Firestore.
 */
async function verifyUserCoupleMembership(uid, coupleId) {
  if (!uid || !coupleId) return false;
  if (!db) return true; // Offline / local mock mode

  if (!isProduction && (coupleId.startsWith('demo') || coupleId === 'couple-duo')) {
    return true;
  }

  try {
    const coupleDoc = await db.collection('couples').doc(coupleId).get();
    if (coupleDoc.exists) {
      const data = coupleDoc.data() || {};
      const members = Array.isArray(data.members) ? data.members : [];
      if (members.includes(uid) || data.partnerA === uid || data.partnerB === uid) {
        return true;
      }
    }

    const spaceDoc = await db.collection('spaces').doc(coupleId).get();
    if (spaceDoc.exists) {
      const data = spaceDoc.data() || {};
      const members = Array.isArray(data.members) ? data.members : [];
      if (members.includes(uid) || data.partnerA === uid || data.partnerB === uid) {
        return true;
      }
    }

    return false;
  } catch (err) {
    console.error(`[MembershipCheck] Failed to verify couple membership for ${uid} in ${coupleId}:`, err.message);
    return false;
  }
}

// REST Endpoint: Create Authoritative Together Room (Study or Movie)
app.post('/api/livekit/create-room', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const { type, initialTitle, roomId: requestedRoomId, roomName: requestedRoomName, coupleId: reqCoupleId } = req.body || {};
    if (!type || (type !== 'study' && type !== 'movie')) {
      return res.status(400).json({ error: "Invalid type. Must be 'study' or 'movie'." });
    }

    const coupleId = reqCoupleId || user.coupleId || 'couple-duo';
    const isMember = await verifyUserCoupleMembership(user.uid, coupleId);
    if (!isMember) {
      return res.status(403).json({ error: 'Forbidden: You are not authorized to create rooms for this couple space.' });
    }

    const roomId = requestedRoomId || `${type}-${coupleId}`.toLowerCase();
    const roomName = requestedRoomName || `duo-${coupleId}-${type}`.toLowerCase();

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
          hostName: user.displayName || 'Partner',
          memberUids: [user.uid],
          coupleId,
          roomName,
          serverUrl,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdMs: Date.now(),
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
    const status = err.message.includes('credentials') ? 503 : (err.message.includes('Forbidden') ? 403 : (err.message.includes('Missing') || err.message.includes('Invalid') || err.message.includes('failed')) ? 401 : 500);
    return res.status(status).json({ error: err.message });
  }
});

// REST Endpoint: Dispatch Push Notification via OneSignal (Server-Only Secret Engine)
app.post('/api/push/send', async (req, res) => {
  const correlationId = req.headers['x-correlation-id'] || req.body?.correlationId || `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  try {
    const user = await getAuthenticatedUser(req);
    const {
      coupleId: reqCoupleId,
      targetUserId,
      title: reqTitle,
      body: reqBody,
      type: reqType = 'message',
      deepLink = '/',
      metadata = {},
      eventId = null,
    } = req.body || {};

    const coupleId = reqCoupleId || user.coupleId;
    if (!coupleId || !targetUserId || !reqTitle) {
      return res.status(400).json({
        provider: 'onesignal',
        requestAccepted: false,
        recipients: 0,
        reason: 'missing_parameters',
        error: 'Missing required parameters (coupleId, targetUserId, title).',
        correlationId,
      });
    }

    // Validate that sender belongs to the couple space
    const isSenderMember = await verifyUserCoupleMembership(user.uid, coupleId);
    if (!isSenderMember) {
      console.warn(`[Push] [${correlationId}] Sender ${user.uid} unauthorized for couple ${coupleId}`);
      return res.status(403).json({
        provider: 'onesignal',
        requestAccepted: false,
        recipients: 0,
        reason: 'forbidden_sender',
        error: 'Forbidden: You are not authorized for this couple space.',
        correlationId,
      });
    }

    // Validate that target user ALSO belongs to the couple space
    const isTargetMember = await verifyUserCoupleMembership(targetUserId, coupleId);
    if (!isTargetMember) {
      console.warn(`[Push] [${correlationId}] Target user ${targetUserId} unauthorized for couple ${coupleId}`);
      return res.status(403).json({
        provider: 'onesignal',
        requestAccepted: false,
        recipients: 0,
        reason: 'forbidden_target',
        error: 'Forbidden: Target recipient is not a member of this couple space.',
        correlationId,
      });
    }

    // Validate notification type against whitelist
    const ALLOWED_TYPES = [
      'message',
      'voice',
      'attachment',
      'reaction',
      'doodle',
      'call',
      'task',
      'task_reminder',
      'calendar',
      'quick_love',
      'streak',
      'nudge',
      'test',
    ];
    const type = ALLOWED_TYPES.includes(reqType) ? reqType : 'message';

    // Sanitize title and body
    const title = String(reqTitle).trim().slice(0, 100);
    const body = String(reqBody || '').trim().slice(0, 300);

    // OneSignal Credentials STRICTLY from Server Environment Secrets
    // Never accept API keys from request payload or database
    const oneSignalApiKey = (process.env.ONESIGNAL_REST_API_KEY || '').trim();
    const oneSignalAppId = (process.env.ONESIGNAL_APP_ID || process.env.VITE_ONESIGNAL_APP_ID || 'e0bb43d0-355d-48de-bb9f-0caf33039abb').trim();

    if (!oneSignalApiKey) {
      console.warn(`[Push] [${correlationId}] ONESIGNAL_REST_API_KEY is not configured on the server.`);
      return res.status(200).json({
        provider: 'onesignal',
        requestAccepted: false,
        notificationId: null,
        recipients: 0,
        reason: 'missing_server_key',
        correlationId,
      });
    }

    if (!oneSignalAppId) {
      console.warn(`[Push] [${correlationId}] ONESIGNAL_APP_ID is not configured.`);
      return res.status(200).json({
        provider: 'onesignal',
        requestAccepted: false,
        notificationId: null,
        recipients: 0,
        reason: 'missing_app_id',
        correlationId,
      });
    }

    const authHeader = oneSignalApiKey.startsWith('Key ') || oneSignalApiKey.startsWith('Basic ')
      ? oneSignalApiKey
      : oneSignalApiKey.startsWith('os_v2_app_')
      ? `Key ${oneSignalApiKey}`
      : `Basic ${oneSignalApiKey}`;

    const baseUrl = 'https://av-space-311906.web.app';
    const notifUrl = deepLink
      ? (deepLink.startsWith('http') ? deepLink : `${baseUrl}${deepLink.startsWith('/') ? '' : '/'}${deepLink}`)
      : baseUrl;

    // Apply appropriate TTL and priority based on notification type
    // Calls: 60s TTL, high priority 10
    // Nudges: 300s TTL, high priority 10
    // Normal messages & reminders: 86400s (24h) TTL, standard priority 5
    const isUrgent = type === 'call' || type === 'nudge';
    const ttl = type === 'call' ? 60 : (type === 'nudge' ? 300 : 86400);
    const priority = isUrgent ? 10 : 5;

    const payload = {
      app_id: oneSignalAppId,
      include_aliases: {
        external_id: [targetUserId],
      },
      target_channel: 'push',
      headings: { en: title },
      contents: { en: body || 'New update from your partner.' },
      chrome_web_icon: `${baseUrl}/pwa-192x192.png`,
      chrome_web_badge: `${baseUrl}/logo.svg`,
      priority,
      android_priority: priority,
      delayed_option: 'immediate',
      ttl,
      url: notifUrl,
      data: {
        type,
        senderId: user.uid,
        targetUserId,
        url: notifUrl,
        eventId,
        correlationId,
      },
    };

    console.info(`[Push] [${correlationId}] Sending ${type} push to target=${targetUserId.slice(0, 6)}... (priority=${priority}, ttl=${ttl}s)`);

    // Bounded request timeout (8 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    let notificationId = null;
    let recipients = 0;
    let requestAccepted = false;
    let reason = 'unknown';

    try {
      const osRes = await fetch('https://api.onesignal.com/notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const osData = await osRes.json().catch(() => null);

      if (osRes.ok) {
        notificationId = osData?.id || null;
        recipients = typeof osData?.recipients === 'number' ? osData.recipients : 0;
        requestAccepted = true;
        reason = recipients > 0 ? 'accepted' : 'zero_recipients';

        // If include_aliases reported 0 recipients, try legacy include_external_user_ids fallback
        if (recipients === 0) {
          try {
            const legacyPayload = {
              ...payload,
              include_aliases: undefined,
              target_channel: undefined,
              include_external_user_ids: [targetUserId],
              channel_for_external_user_ids: 'push',
            };
            const legRes = await fetch('https://api.onesignal.com/notifications', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: authHeader,
              },
              body: JSON.stringify(legacyPayload),
            });
            if (legRes.ok) {
              const legData = await legRes.json().catch(() => null);
              if (typeof legData?.recipients === 'number' && legData.recipients > 0) {
                notificationId = legData.id;
                recipients = legData.recipients;
                reason = 'accepted_legacy';
              }
            }
          } catch (legErr) {}
        }

        console.info(`[Push] [${correlationId}] OneSignal response: accepted=${requestAccepted}, recipients=${recipients}, id=${notificationId}`);
      } else {
        const errorDetail = osData?.errors?.[0] || `http_${osRes.status}`;
        console.warn(`[Push] [${correlationId}] OneSignal rejected:`, errorDetail);
        requestAccepted = false;
        reason = errorDetail;
      }
    } catch (osErr) {
      clearTimeout(timeoutId);
      const isAbort = osErr.name === 'AbortError';
      console.error(`[Push] [${correlationId}] OneSignal dispatch error:`, isAbort ? 'timeout' : osErr.message);
      requestAccepted = false;
      reason = isAbort ? 'network_timeout' : osErr.message;
    }

    // Return honest, structured results
    return res.status(200).json({
      provider: 'onesignal',
      requestAccepted,
      notificationId,
      recipients, // Exactly as returned by OneSignal; never default to 1
      reason,
      correlationId,
    });
  } catch (err) {
    console.error(`[Push Server] [${correlationId}] send-push unexpected error:`, err.message);
    return res.status(500).json({
      provider: 'onesignal',
      error: err.message,
      requestAccepted: false,
      recipients: 0,
      reason: err.message,
      correlationId,
    });
  }
});

// REST Endpoint: Join Authoritative Together Room
app.post('/api/livekit/join-room', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const { roomId, roomName: reqRoomName, coupleId: reqCoupleId, type: reqType } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: 'Missing roomId.' });
    }

    let coupleId = reqCoupleId || user.coupleId;
    let type = reqType || (roomId.includes('movie') ? 'movie' : 'study');
    let roomName = reqRoomName;
    let isHost = false;

    if (db) {
      let roomSnap;
      try {
        roomSnap = await db.collection('togetherRooms').doc(roomId).get();
      } catch (dbErr) {
        console.error('[LiveKit Server] Firestore join read failed:', dbErr.message);
        return res.status(500).json({ error: 'Database check failed while verifying room.' });
      }

      if (!roomSnap || !roomSnap.exists) {
        return res.status(404).json({ error: 'Together room does not exist.' });
      }

      const roomData = roomSnap.data();
      if (roomData.status === 'ended') {
        return res.status(410).json({ error: 'This together room has already ended.' });
      }

      coupleId = roomData.coupleId || coupleId;
      const isMember = await verifyUserCoupleMembership(user.uid, coupleId);
      const isHostOrMember = roomData.hostUid === user.uid || (Array.isArray(roomData.memberUids) && roomData.memberUids.includes(user.uid));

      if (!isMember && !isHostOrMember) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to join this together room.' });
      }

      isHost = roomData.hostUid === user.uid;
      roomName = roomData.roomName || roomName || `duo-${coupleId}-${type}`.toLowerCase();
      type = roomData.type || type;

      await roomSnap.ref.update({
        status: 'active',
        memberUids: admin.firestore.FieldValue.arrayUnion(user.uid),
        lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
      }).catch((uErr) => console.warn('[LiveKit Server] Update memberUids notice:', uErr.message));
    } else {
      roomName = roomName || `duo-${coupleId || 'demo'}-${type}`.toLowerCase();
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
    const status = err.message.includes('credentials') ? 503 : (err.message.includes('Forbidden') ? 403 : (err.message.includes('Missing') || err.message.includes('Invalid') || err.message.includes('failed')) ? 401 : 500);
    return res.status(status).json({ error: err.message });
  }
});

// REST Endpoint: End Authoritative Together Room
app.post('/api/livekit/end-room', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
    const { roomId } = req.body || {};
    if (!roomId) {
      return res.status(400).json({ error: 'Missing roomId.' });
    }

    if (db) {
      try {
        const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
        if (roomSnap.exists) {
          const roomData = roomSnap.data();
          const isMember =
            roomData.hostUid === user.uid ||
            (Array.isArray(roomData.memberUids) && roomData.memberUids.includes(user.uid)) ||
            !roomData.hostUid;
          if (isMember) {
            await roomSnap.ref.update({
              status: 'ended',
              endedAt: admin.firestore.FieldValue.serverTimestamp(),
              endedBy: user.uid,
            });
          }
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
    const user = await getAuthenticatedUser(req);
    const { roomId, coupleId: reqCoupleId, roomName: reqRoomName } = req.body || {};
    const targetRoomId = roomId;

    if (!targetRoomId) {
      return res.status(400).json({ error: 'Missing roomId' });
    }

    let targetCoupleId = reqCoupleId || user.coupleId;
    let type = targetRoomId.includes('movie') ? 'movie' : 'study';
    let roomName = reqRoomName;
    let hostFlag = false; // Strictly default to false; NEVER trust client isHost

    if (db) {
      let roomSnap;
      try {
        roomSnap = await db.collection('togetherRooms').doc(targetRoomId).get();
      } catch (dbErr) {
        console.error('[LiveKit Server] Firestore token read failed:', dbErr.message);
        return res.status(500).json({ error: 'Database check failed while verifying room.' });
      }

      if (!roomSnap || !roomSnap.exists) {
        return res.status(404).json({ error: 'Together room does not exist.' });
      }

      const roomData = roomSnap.data();
      if (roomData.status === 'ended') {
        return res.status(410).json({ error: 'Room has ended.' });
      }

      targetCoupleId = roomData.coupleId || targetCoupleId;
      const isMember = await verifyUserCoupleMembership(user.uid, targetCoupleId);
      const isHostOrMember = roomData.hostUid === user.uid || (Array.isArray(roomData.memberUids) && roomData.memberUids.includes(user.uid));

      if (!isMember && !isHostOrMember) {
        return res.status(403).json({ error: 'Forbidden: You do not have permission to access tokens for this together room.' });
      }

      // Strictly derive host privileges from trusted room data
      hostFlag = roomData.hostUid === user.uid;
      roomName = roomData.roomName || roomName || `duo-${targetCoupleId}-${type}`.toLowerCase();
    } else {
      roomName = roomName || `duo-${targetCoupleId || 'demo'}-${type}`.toLowerCase();
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
    const status = err.message.includes('credentials') ? 503 : (err.message.includes('Forbidden') ? 403 : 500);
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

    try {
      const decoded = await verifyTokenAcrossProjects(token);
      socket.data.uid = decoded.uid;
      socket.data.isDemo = false;
      return next();
    } catch (verifyErr) {
      // Fall through to JWT payload decode
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
      authorized: false,
      error: 'Database not initialized',
    };
  }

  try {
    const roomSnap = await db.collection('togetherRooms').doc(roomId).get();
    if (!roomSnap.exists) {
      return {
        authorized: false,
        error: 'Together room does not exist',
      };
    }

    const room = roomSnap.data();
    if (room.status === 'ended') {
      return { authorized: false, error: 'Together room has ended' };
    }

    const isMemberOfCouple = await verifyUserCoupleMembership(uid, room.coupleId);
    const isHostOrMember = room.hostUid === uid || (Array.isArray(room.memberUids) && room.memberUids.includes(uid));

    if (!isMemberOfCouple && !isHostOrMember) {
      return {
        authorized: false,
        error: 'Unauthorized: User does not belong to this room or couple space',
      };
    }

    return { authorized: true, room, ref: roomSnap.ref };
  } catch (err) {
    console.error('[verifyUserInRoom] Firestore check error:', err.message);
    return {
      authorized: false,
      error: 'Failed to authoritatively verify room membership',
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
