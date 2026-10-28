import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onRequest, onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as admin from "firebase-admin";
import { AccessToken, TrackSource } from "livekit-server-sdk";

const livekitUrlSecret = defineSecret("LIVEKIT_URL");
const livekitApiKeySecret = defineSecret("LIVEKIT_API_KEY");
const livekitApiSecretSecret = defineSecret("LIVEKIT_API_SECRET");
const oneSignalRestApiKeySecret = defineSecret("ONESIGNAL_REST_API_KEY");

function getSecretVal(secretParam: any, envKey: string): string {
  if (process.env[envKey]) return process.env[envKey]!;
  try {
    return secretParam?.value() || "";
  } catch {
    return "";
  }
}

admin.initializeApp();
const db = admin.firestore();

/**
 * Trigger: When a notification document is created in couples/{coupleId}/notifications/{notifId}
 * DEPRECATED: Web push is authoritatively dispatched via OneSignal (sendPushNotification).
 * Retained as a safe no-op to prevent duplicate notifications and maintain deployment stability.
 */
export const onNotificationCreated = onDocumentCreated(
  "couples/{coupleId}/notifications/{notifId}",
  async () => {
    // Deprecated: Push notifications are handled via OneSignal Cloud Function (sendPushNotification).
    // Intentionally no-op to avoid double notification delivery.
    return;
  }
);

/**
 * Trigger: When a call document is created in couples/{coupleId}/calls/{callId}
 * Dispatches high-urgency ringing call alert to the callee.
 */
export const onCallCreated = onDocumentCreated(
  "couples/{coupleId}/calls/{callId}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const call = snap.data();
    if (call.status !== "ringing") return;

    const { coupleId, callId } = event.params;
    let calleeId = call.calleeId;

    try {
      if (!calleeId) {
        const coupleSnap = await db.collection("couples").doc(coupleId).get();
        if (coupleSnap.exists) {
          const members: string[] = coupleSnap.data()?.members || [];
          calleeId = members.find((m) => m !== call.callerId) || null;
        }
      }

      if (!calleeId) return;

      const devicesSnap = await db
        .collection("profiles")
        .doc(calleeId)
        .collection("devices")
        .get();

      if (devicesSnap.empty) return;

      const tokens: string[] = [];
      devicesSnap.forEach((docSnap) => {
        const data = docSnap.data();
        if (data.token && typeof data.token === "string") {
          tokens.push(data.token);
        }
      });

      if (tokens.length === 0) return;

      const callerName = call.callerName || "Your partner";
      const callType = call.type === "video" ? "Video" : "Voice";

      await admin.messaging().sendEachForMulticast({
        tokens,
        notification: {
          title: `Incoming ${callType} Call 📞`,
          body: `${callerName} is calling you...`,
        },
        data: {
          type: "call",
          callId,
          coupleId,
          callerId: call.callerId,
          callerName,
          callType: call.type,
          url: "/?action=call",
        },
        webpush: {
          headers: {
            Urgency: "high",
          },
          notification: {
            title: `Incoming ${callType} Call 📞`,
            body: `${callerName} is calling you...`,
            icon: "/pwa-192x192.png",
            badge: "/favicon.svg",
            tag: `duo-call-${callId}`,
            renotify: true,
            requireInteraction: true,
            data: {
              type: "call",
              callId,
              coupleId,
              url: "/?action=call",
            },
            actions: [
              { action: "answer", title: "Answer 📞" },
              { action: "decline", title: "Decline ❌" },
            ],
          },
          fcmOptions: {
            link: "/?action=call",
          },
        },
      });

      console.log(`[CallPush] Dispatched call alert for call ${callId}`);
    } catch (err) {
      console.error(`[CallPush] Error dispatching call push:`, err);
    }
  }
);

/**
 * HTTP Endpoint: Notification action handler
 */
export const notificationAction = onRequest({ cors: true, invoker: "public" }, async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const { action, taskId, coupleId } = req.body || {};
  if (action && taskId && coupleId) {
    try {
      if (action === "done") {
        await db
          .collection("couples")
          .doc(coupleId)
          .collection("tasks")
          .doc(taskId)
          .update({
            status: "done",
            completedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }
      res.status(200).json({ success: true, action });
      return;
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      return;
    }
  }

  res.status(200).json({ success: true });
});

// ─────────────────────────────────────────────────────────────────
// LiveKit Token Helper & Activity Sessions (LiveKit Cloud)
// ─────────────────────────────────────────────────────────────────

async function createLiveKitTokenForUser(params: {
  roomName: string;
  identity: string;
  displayName: string;
  isHost: boolean;
}): Promise<{ token: string; serverUrl: string }> {
  const apiKey = getSecretVal(livekitApiKeySecret, "LIVEKIT_API_KEY");
  const apiSecret = getSecretVal(livekitApiSecretSecret, "LIVEKIT_API_SECRET");
  const serverUrl = getSecretVal(livekitUrlSecret, "LIVEKIT_URL") || "wss://av-space-cgq1lsbg.livekit.cloud";

  if (!apiKey || !apiSecret) {
    console.warn("[LiveKit] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set in environment.");
    return { token: "", serverUrl };
  }

  const at = new AccessToken(apiKey, apiSecret, {
    identity: params.identity,
    name: params.displayName || "Partner",
    ttl: "6h",
  });

  at.addGrant({
    room: params.roomName,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
    roomAdmin: params.isHost,
  });

  const token = await at.toJwt();
  return { token, serverUrl };
}

/**
 * Callable Cloud Function: Issues a secure, short-lived LiveKit token.
 * Verifies authenticated caller, couple membership, and room membership.
 */
export const getLiveKitToken = onCall({
  cors: true,
  invoker: "public",
  secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to request a media token.");
  }
  const uid = request.auth.uid;
  const { roomId, coupleId } = request.data || {};

  if (!roomId || !coupleId) {
    throw new HttpsError("invalid-argument", "Missing roomId or coupleId.");
  }

  // 1. Verify caller belongs to the couple
  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists) {
    throw new HttpsError("not-found", "Couple space not found.");
  }
  const coupleData = coupleSnap.data();
  const members: string[] = coupleData?.members || [];
  if (!members.includes(uid)) {
    throw new HttpsError("permission-denied", "Unauthorized: caller does not belong to this couple space.");
  }

  // 2. Authoritative room verification: require existing, open room with verified membership
  const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Together room not found. Cannot issue media token.");
  }
  const rData = roomSnap.data()!;
  if (rData.status === "ended") {
    throw new HttpsError("failed-precondition", "This media room has already ended.");
  }
  if (rData.coupleId !== coupleId) {
    throw new HttpsError("permission-denied", "Unauthorized: room does not match couple space.");
  }
  const memberUids: string[] = rData.memberUids || [];
  if (!memberUids.includes(uid)) {
    throw new HttpsError("permission-denied", "Unauthorized: caller is not in this room's member list.");
  }
  const isHost = rData.hostUid === uid;

  const profileSnap = await db.collection("profiles").doc(uid).get();
  const displayName = profileSnap.data()?.displayName || "Partner";

  const canonicalRoomName = `duo-${coupleId}-${roomId}`.toLowerCase();
  const { token, serverUrl } = await createLiveKitTokenForUser({
    roomName: canonicalRoomName,
    identity: uid,
    displayName,
    isHost,
  });

  if (!token) {
    throw new HttpsError("internal", "Failed to issue LiveKit token. Verify server secrets.");
  }

  return {
    token,
    serverUrl,
    roomName: canonicalRoomName,
    identity: uid,
    displayName,
    isHost,
  };
});

/**
 * Callable Cloud Function: Securely dispatches push notifications via OneSignal.
 * Uses trusted server secret ONESIGNAL_REST_API_KEY. Never exposes key to browser.
 */
export const sendPushNotification = onCall({
  cors: true,
  invoker: "public",
  secrets: [oneSignalRestApiKeySecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const uid = request.auth.uid;
  const {
    coupleId,
    targetUserId,
    title,
    body,
    type,
    deepLink,
    metadata,
    eventId,
    correlationId: clientCorrelationId,
  } = request.data || {};

  const correlationId =
    clientCorrelationId ||
    `push-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  if (!coupleId || !targetUserId || !title) {
    throw new HttpsError("invalid-argument", "Missing required push notification parameters.");
  }

  // Verify sender and recipient belong to the verified couple
  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists) {
    throw new HttpsError("not-found", "Couple space not found.");
  }
  const members: string[] = coupleSnap.data()?.members || [];
  if (!members.includes(uid) || !members.includes(targetUserId)) {
    throw new HttpsError("permission-denied", "Unauthorized push target or sender.");
  }

  // Idempotency: return existing result if event was already dispatched recently
  if (eventId) {
    try {
      const existingDoc = await db
        .collection("couples")
        .doc(coupleId)
        .collection("pushEvents")
        .doc(eventId)
        .get();

      if (existingDoc.exists) {
        const existingData = existingDoc.data();
        console.log(`[PushDispatcher] Idempotent hit for event ${eventId} (${correlationId})`);
        return {
          success: true,
          requestAccepted: true,
          notificationId: existingData?.notificationId || null,
          recipients: existingData?.recipients || 1,
          reason: "idempotent_duplicate",
          correlationId,
        };
      }
    } catch (idemErr) {
      console.warn(`[PushDispatcher] Idempotency check notice (${correlationId}):`, idemErr);
    }
  }

  const oneSignalApiKey = getSecretVal(oneSignalRestApiKeySecret, "ONESIGNAL_REST_API_KEY");
  // Synchronized deliberate fallback App ID matching client configuration
  const oneSignalAppId = process.env.ONESIGNAL_APP_ID || "e0bb43d0-355d-48de-bb9f-0caf33039abb";

  if (!oneSignalApiKey || !oneSignalAppId) {
    console.warn("[OneSignal Server] Push server configuration incomplete: missing API key or App ID.");
    return {
      success: false,
      requestAccepted: false,
      reason: "Server push configuration missing",
      correlationId,
    };
  }

  const cleanKey = oneSignalApiKey.trim();
  const authHeader = cleanKey.startsWith("Key ") || cleanKey.startsWith("Basic ")
    ? cleanKey
    : cleanKey.startsWith("os_v2_app_")
    ? `Key ${cleanKey}`
    : `Basic ${cleanKey}`;

  const cleanTitle = String(title).slice(0, 100);
  const cleanBody = String(body || "").slice(0, 300);

  const payload = {
    app_id: oneSignalAppId,
    include_aliases: {
      external_id: [targetUserId],
    },
    target_channel: "push",
    headings: { en: cleanTitle },
    contents: { en: cleanBody },
    priority: 10,
    android_priority: 10,
    delayed_option: "immediate",
    ttl: type === "call" ? 120 : 86400,
    data: {
      type: type || "message",
      senderId: uid,
      targetUserId,
      url: deepLink || "/",
      eventId: eventId || null,
      correlationId,
      ...(metadata || {}),
    },
  };

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), 8000);
  const startTime = Date.now();
  let resp: Response;

  try {
    resp = await fetch("https://api.onesignal.com/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutTimer);
    const latency = Date.now() - startTime;
    const isTimeout = err?.name === "AbortError";
    console.error(
      `[PushDispatcher] Network error (${correlationId}): ${isTimeout ? "Timeout (8000ms)" : err?.message}, recipient: ${targetUserId}, type: ${type || "message"}, latency: ${latency}ms`
    );
    return {
      success: false,
      requestAccepted: false,
      reason: isTimeout ? "timeout" : "network_error",
      correlationId,
    };
  } finally {
    clearTimeout(timeoutTimer);
  }

  const latency = Date.now() - startTime;
  let responseData: any = null;
  try {
    responseData = await resp.json();
  } catch {
    responseData = null;
  }

  if (!resp.ok) {
    console.warn(
      `[PushDispatcher] OneSignal API HTTP ${resp.status} (${correlationId}): recipient: ${targetUserId}, type: ${type || "message"}, latency: ${latency}ms`
    );
    return {
      success: false,
      requestAccepted: false,
      status: resp.status,
      reason: "provider_error",
      errors: responseData?.errors || null,
      correlationId,
    };
  }

  const notificationId = responseData?.id || null;
  const recipients = typeof responseData?.recipients === "number" ? responseData.recipients : 0;
  const hasNoRecipients = recipients === 0;

  console.log(
    `[PushDispatcher] Push dispatched (${correlationId}): recipient: ${targetUserId}, type: ${type || "message"}, onesignal_id: ${notificationId}, recipients: ${recipients}, latency: ${latency}ms`
  );

  if (hasNoRecipients) {
    return {
      success: false,
      requestAccepted: true,
      notificationId,
      recipients: 0,
      reason: "no_matching_subscription",
      correlationId,
    };
  }

  // Record idempotency record
  if (eventId) {
    db.collection("couples")
      .doc(coupleId)
      .collection("pushEvents")
      .doc(eventId)
      .set({
        eventId,
        targetUserId,
        type: type || "message",
        notificationId,
        recipients,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch((writeErr) => {
        console.warn(`[PushDispatcher] Push event recording notice (${correlationId}):`, writeErr);
      });
  }

  return {
    success: true,
    requestAccepted: true,
    notificationId,
    recipients,
    reason: "accepted",
    correlationId,
  };
});

/**
 * Creates an activity session (study | movie) in Firestore with LiveKit Cloud media.
 * Dispatches a polite non-ringing room invitation push notification to the partner.
 */
export const startActivitySession = onCall({
  cors: true,
  invoker: "public",
  secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to start a session.");
  }
  const uid = request.auth.uid;
  const { coupleId, type, initialTitle } = request.data || {};

  if (!coupleId || !type || (type !== "study" && type !== "movie")) {
    throw new HttpsError("invalid-argument", "Invalid session parameters. Must provide coupleId and type ('study' | 'movie').");
  }

  // 1. Verify caller belongs to the couple
  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists) {
    throw new HttpsError("not-found", "Couple space not found.");
  }
  const coupleData = coupleSnap.data();
  const members: string[] = coupleData?.members || [];
  if (!members.includes(uid)) {
    throw new HttpsError("permission-denied", "You do not belong to this couple space.");
  }

  const partnerId = members.find((m) => m !== uid) || null;
  const callerProfileSnap = await db.collection("profiles").doc(uid).get();
  const callerName = callerProfileSnap.data()?.displayName || "Your partner";

  const roomName = `duo-${type}-${coupleId.substring(0, 6)}-${Date.now()}`.toLowerCase();
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 6 * 3600 * 1000);

  // Issue host token for LiveKit
  const { token: hostToken, serverUrl } = await createLiveKitTokenForUser({
    roomName,
    identity: uid,
    displayName: callerName,
    isHost: true,
  });

  // Save session document in Firestore
  const sessionsCol = db.collection("couples").doc(coupleId).collection("sessions");
  const sessionRef = sessionsCol.doc();
  const sessionId = sessionRef.id;

  const sessionDoc: any = {
    id: sessionId,
    coupleId,
    type,
    status: "open",
    createdBy: uid,
    createdByName: callerName,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    roomName,
    livekitServerUrl: serverUrl,
    participants: members,
  };

  if (type === "study") {
    sessionDoc.studyState = {
      mode: "focus",
      durationMinutes: 25,
      breakMinutes: 5,
      timerSecondsRemaining: 25 * 60,
      isRunning: false,
      taskName: initialTitle || "Deep Work & Cozy Study",
      partnerStatuses: {
        [uid]: "studying",
      },
    };
  } else {
    sessionDoc.movieState = {
      mode: "screen",
      title: initialTitle || "Movie Night 🍿",
      isPlaying: false,
      currentTime: 0,
      sharingUserId: null,
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
    };
  }

  await sessionRef.set(sessionDoc);

  // Notify the other partner (Non-ringing, gentle room invite)
  if (partnerId) {
    try {
      const devicesSnap = await db
        .collection("profiles")
        .doc(partnerId)
        .collection("devices")
        .get();

      const tokens: string[] = [];
      devicesSnap.forEach((d) => {
        const token = d.data()?.token;
        if (token && typeof token === "string") tokens.push(token);
      });

      if (tokens.length > 0) {
        const title = type === "study" ? "📚 Study Space is Open" : "🎬 Movie Night is Open";
        const body = `${callerName} opened a ${type === "study" ? "study session" : "movie room"}. Join when you're ready!`;
        const deepLink = `/?action=together&subtab=${type}&sessionId=${sessionId}`;

        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: {
            type: "session_invite",
            sessionType: type,
            sessionId,
            coupleId,
            url: deepLink,
          },
          webpush: {
            headers: { Urgency: "normal" },
            notification: {
              title,
              body,
              icon: "/pwa-192x192.png",
              badge: "/logo.svg",
              tag: `duo-session-${sessionId}`,
              renotify: true,
              data: { url: deepLink },
              actions: [
                { action: "join", title: "Join Room 🚪" },
                { action: "dismiss", title: "Later" },
              ],
            },
          },
        });
      }
    } catch (pushErr) {
      console.warn("[SessionPush] Error sending push:", pushErr);
    }
  }

  return {
    sessionId,
    roomName,
    livekitToken: hostToken,
    livekitUrl: serverUrl,
  };
});

/**
 * Validates partner permissions and issues a participant meeting token for LiveKit Cloud.
 */
export const joinActivitySession = onCall({
  cors: true,
  invoker: "public",
  secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to join a session.");
  }
  const uid = request.auth.uid;
  const { coupleId, sessionId } = request.data || {};

  if (!coupleId || !sessionId) {
    throw new HttpsError("invalid-argument", "Missing coupleId or sessionId.");
  }

  // 1. Verify user belongs to couple
  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists) {
    throw new HttpsError("not-found", "Couple space not found.");
  }
  const members: string[] = coupleSnap.data()?.members || [];
  if (!members.includes(uid)) {
    throw new HttpsError("permission-denied", "You do not belong to this couple space.");
  }

  // 2. Read stored session
  const sessionSnap = await db
    .collection("couples")
    .doc(coupleId)
    .collection("sessions")
    .doc(sessionId)
    .get();

  if (!sessionSnap.exists) {
    throw new HttpsError("not-found", "Session not found.");
  }

  const session = sessionSnap.data();
  if (!session || session.status !== "open") {
    throw new HttpsError("failed-precondition", "This session has already ended.");
  }

  if (session.expiresAt && session.expiresAt.toMillis() < Date.now()) {
    throw new HttpsError("failed-precondition", "This session has expired.");
  }

  const profileSnap = await db.collection("profiles").doc(uid).get();
  const displayName = profileSnap.data()?.displayName || "Partner";

  const roomName = session.roomName || session.dailyRoomName || `duo-${session.type}-${sessionId}`;
  const isHost = session.createdBy === uid;

  const { token, serverUrl } = await createLiveKitTokenForUser({
    roomName,
    identity: uid,
    displayName,
    isHost,
  });

  return {
    roomName,
    token,
    serverUrl,
    displayName,
    sessionType: session.type,
    sessionId,
  };
});

/**
 * Closes the activity session explicitly for both partners.
 */
export const endActivitySession = onCall({ cors: true, invoker: "public" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const uid = request.auth.uid;
  const { coupleId, sessionId } = request.data || {};

  if (!coupleId || !sessionId) {
    throw new HttpsError("invalid-argument", "Missing parameters.");
  }

  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists || !coupleSnap.data()?.members?.includes(uid)) {
    throw new HttpsError("permission-denied", "Unauthorized.");
  }

  await db
    .collection("couples")
    .doc(coupleId)
    .collection("sessions")
    .doc(sessionId)
    .update({
      status: "ended",
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
      endedBy: uid,
    });

  return { success: true };
});

/**
 * Callable Cloud Function: Creates a Together Room (Study or Movie) with LiveKit Cloud.
 * Verifies signed-in user, looks up couple members from trusted record, creates
 * Firestore togetherRooms/{roomId} document, and issues host LiveKit token.
 */
export const createTogetherRoom = onCall({
  cors: true,
  invoker: "public",
  secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to create a room.");
  }
  const uid = request.auth.uid;
  const { type, initialTitle } = request.data || {};

  if (!type || (type !== "study" && type !== "movie")) {
    throw new HttpsError("invalid-argument", "Room type must be 'study' or 'movie'.");
  }

  // Look up user's profile to find couple
  const profileSnap = await db.collection("profiles").doc(uid).get();
  const profileData = profileSnap.data();
  const coupleId = profileData?.coupleId;

  if (!coupleId) {
    throw new HttpsError("failed-precondition", "You must be paired in a couple space to create a together room.");
  }

  // Look up trusted couple record
  const coupleSnap = await db.collection("couples").doc(coupleId).get();
  if (!coupleSnap.exists) {
    throw new HttpsError("not-found", "Couple space record not found.");
  }

  const coupleData = coupleSnap.data();
  const members: string[] = coupleData?.members || [];
  if (!members.includes(uid)) {
    throw new HttpsError("permission-denied", "You are not a member of this couple space.");
  }

  const partnerId = members.find((m) => m !== uid) || null;
  const callerName = profileData?.displayName || "Host";

  // Prevent duplicate active rooms for the same couple: check for any active room of this type
  const existingActive = await db.collection("togetherRooms")
    .where("coupleId", "==", coupleId)
    .where("type", "==", type)
    .where("status", "in", ["waiting", "active"])
    .limit(1)
    .get();

  if (!existingActive.empty) {
    const existingDoc = existingActive.docs[0];
    const existingData = existingDoc.data();
    // If room is less than 6 hours old, reuse or return it
    const createdMs = existingData.createdAt?.toMillis ? existingData.createdAt.toMillis() : Date.now();
    if (Date.now() - createdMs < 6 * 3600 * 1000) {
      const canonicalRoom = existingData.roomName || `duo-${coupleId}-${existingDoc.id}`.toLowerCase();
      const { token: hostToken, serverUrl } = await createLiveKitTokenForUser({
        roomName: canonicalRoom,
        identity: uid,
        displayName: callerName,
        isHost: true,
      });

      return {
        roomId: existingDoc.id,
        roomName: canonicalRoom,
        token: hostToken,
        serverUrl,
        livekitUrl: serverUrl,
      };
    } else {
      // Mark old room ended
      await existingDoc.ref.update({
        status: "ended",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  // Create Firestore document togetherRooms/{roomId}
  const roomRef = db.collection("togetherRooms").doc();
  const roomId = roomRef.id;
  const roomName = `duo-${coupleId}-${roomId}`.toLowerCase();

  // Issue host LiveKit token
  const { token: hostToken, serverUrl } = await createLiveKitTokenForUser({
    roomName,
    identity: uid,
    displayName: callerName,
    isHost: true,
  });

  const roomDoc: any = {
    roomId,
    type,
    status: "waiting",
    hostUid: uid,
    memberUids: members.length === 2 ? members : [uid, ...(partnerId ? [partnerId] : [])],
    coupleId,
    roomName,
    serverUrl,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    endedAt: null,
    revision: 1,
    study: type === "study" ? {
      mode: "focus",
      durationSeconds: 25 * 60,
      startedAt: null,
      pausedRemainingSeconds: 25 * 60,
    } : null,
    movie: type === "movie" ? {
      screenShareOwnerUid: null,
      title: initialTitle || "Movie Night 🍿",
    } : null,
  };

  await roomRef.set(roomDoc);

  // Add host to participants subcollection
  await roomRef.collection("participants").doc(uid).set({
    uid,
    displayName: callerName,
    role: "host",
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Notify partner
  if (partnerId) {
    try {
      const devicesSnap = await db.collection("profiles").doc(partnerId).collection("devices").get();
      const tokens: string[] = [];
      devicesSnap.forEach((d) => {
        const t = d.data()?.token;
        if (t && typeof t === "string") tokens.push(t);
      });

      if (tokens.length > 0) {
        const title = type === "study" ? "📚 Study Space is Open" : "🎬 Movie Night is Open";
        const body = `${callerName} started a ${type === "study" ? "study session" : "movie room"}. Tap to join!`;
        const deepLink = `/?action=together&subtab=${type}&roomId=${roomId}`;

        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: {
            type: "together_room_invite",
            roomType: type,
            roomId,
            coupleId,
            url: deepLink,
          },
          webpush: {
            headers: { Urgency: "normal" },
            notification: {
              title,
              body,
              icon: "/pwa-192x192.png",
              badge: "/logo.svg",
              tag: `duo-together-${roomId}`,
              renotify: true,
              data: { url: deepLink },
              actions: [
                { action: "join", title: "Join Room 🚪" },
                { action: "dismiss", title: "Later" },
              ],
            },
          },
        });
      }
    } catch (e) {
      console.warn("[TogetherRoomPush] Failed to dispatch push invite:", e);
    }
  }

  return {
    roomId,
    roomName,
    token: hostToken,
    serverUrl,
    livekitUrl: serverUrl,
  };
});

/**
 * Callable Cloud Function: Joins an existing Together Room with LiveKit Cloud.
 * Checks room exists and is open, verifies user membership, updates status to active,
 * records participant, and issues participant LiveKit token.
 */
export const joinTogetherRoom = onCall({
  cors: true,
  invoker: "public",
  secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in to join a room.");
  }
  const uid = request.auth.uid;
  const { roomId } = request.data || {};

  if (!roomId) {
    throw new HttpsError("invalid-argument", "Missing roomId.");
  }

  const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Together room not found.");
  }

  const roomData = roomSnap.data()!;
  if (roomData.status === "ended") {
    throw new HttpsError("failed-precondition", "This together room has already ended.");
  }

  const memberUids: string[] = roomData.memberUids || [];
  if (!memberUids.includes(uid)) {
    throw new HttpsError("permission-denied", "You are not an authorized member of this room.");
  }

  // Load user profile
  const profileSnap = await db.collection("profiles").doc(uid).get();
  const displayName = profileSnap.data()?.displayName || "Partner";

  const roomName = roomData.roomName || `duo-${roomData.coupleId}-${roomId}`.toLowerCase();
  const isHost = roomData.hostUid === uid;

  const { token, serverUrl } = await createLiveKitTokenForUser({
    roomName,
    identity: uid,
    displayName,
    isHost,
  });

  // Update room status to active if waiting
  if (roomData.status === "waiting") {
    await roomSnap.ref.update({
      status: "active",
      revision: admin.firestore.FieldValue.increment(1),
    });
  }

  // Record participant
  await roomSnap.ref.collection("participants").doc(uid).set({
    uid,
    displayName,
    role: isHost ? "host" : "participant",
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    roomId,
    roomName,
    token,
    serverUrl,
    livekitUrl: serverUrl,
    type: roomData.type,
    hostUid: roomData.hostUid,
    status: "active",
  };
});

/**
 * Callable Cloud Function: Ends a Together Room.
 * Checks host/member authorization, marks Firestore doc ended.
 */
export const endTogetherRoom = onCall({ cors: true, invoker: "public" }, async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const uid = request.auth.uid;
  const { roomId } = request.data || {};

  if (!roomId) {
    throw new HttpsError("invalid-argument", "Missing roomId.");
  }

  const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Room not found.");
  }

  const roomData = roomSnap.data()!;
  if (roomData.hostUid !== uid) {
    throw new HttpsError("permission-denied", "Only the room host can end this together room.");
  }

  await roomSnap.ref.update({
    status: "ended",
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
    endedBy: uid,
    revision: admin.firestore.FieldValue.increment(1),
  });

  return { success: true };
});
