"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.endTogetherRoom = exports.joinTogetherRoom = exports.createTogetherRoom = exports.endActivitySession = exports.joinActivitySession = exports.startActivitySession = exports.sendPushNotification = exports.getLiveKitToken = exports.notificationAction = exports.onCallCreated = exports.onNotificationCreated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const admin = __importStar(require("firebase-admin"));
const livekit_server_sdk_1 = require("livekit-server-sdk");
const livekitUrlSecret = (0, params_1.defineSecret)("LIVEKIT_URL");
const livekitApiKeySecret = (0, params_1.defineSecret)("LIVEKIT_API_KEY");
const livekitApiSecretSecret = (0, params_1.defineSecret)("LIVEKIT_API_SECRET");
const oneSignalRestApiKeySecret = (0, params_1.defineSecret)("ONESIGNAL_REST_API_KEY");
function getSecretVal(secretParam, envKey) {
    if (process.env[envKey])
        return process.env[envKey];
    try {
        return secretParam?.value() || "";
    }
    catch {
        return "";
    }
}
admin.initializeApp();
const db = admin.firestore();
/**
 * Trigger: When a notification document is created in couples/{coupleId}/notifications/{notifId}
 * Dispatches background Web Push / FCM notifications to the partner's registered devices.
 */
exports.onNotificationCreated = (0, firestore_1.onDocumentCreated)("couples/{coupleId}/notifications/{notifId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const notif = snap.data();
    const { coupleId, notifId } = event.params;
    const senderId = notif.senderId;
    try {
        // 1. Resolve recipient UID
        let recipientId = notif.metadata?.recipientId || null;
        if (!recipientId) {
            const coupleSnap = await db.collection("couples").doc(coupleId).get();
            if (coupleSnap.exists) {
                const members = coupleSnap.data()?.members || [];
                recipientId = members.find((m) => m !== senderId) || null;
            }
        }
        if (!recipientId) {
            console.warn(`[PushDispatcher] Could not determine recipient for notif ${notifId}`);
            return;
        }
        // 2. Query all registered device tokens for the recipient
        const devicesSnap = await db
            .collection("profiles")
            .doc(recipientId)
            .collection("devices")
            .get();
        if (devicesSnap.empty) {
            console.log(`[PushDispatcher] No devices registered for user ${recipientId}`);
            return;
        }
        const tokens = [];
        const tokenDocMap = new Map(); // token -> deviceDocId
        devicesSnap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.token && typeof data.token === "string") {
                tokens.push(data.token);
                tokenDocMap.set(data.token, docSnap.id);
            }
        });
        if (tokens.length === 0)
            return;
        const title = notif.title || "Duo";
        const body = notif.body || "New update from your partner.";
        const type = notif.type || "message";
        const deepLink = notif.deepLink || "/";
        // 3. Build FCM multicast message
        const response = await admin.messaging().sendEachForMulticast({
            tokens,
            notification: {
                title,
                body,
            },
            data: {
                coupleId,
                notifId,
                type,
                senderId: senderId || "",
                senderName: notif.senderName || "",
                url: deepLink,
            },
            webpush: {
                headers: {
                    Urgency: type === "call" ? "high" : "normal",
                },
                notification: {
                    title,
                    body,
                    icon: "/pwa-192x192.png",
                    badge: "/favicon.svg",
                    tag: `duo-${type}-${notifId}`,
                    renotify: true,
                    requireInteraction: type === "call",
                    data: {
                        coupleId,
                        notifId,
                        type,
                        url: deepLink,
                        senderId: senderId || "",
                    },
                    actions: [
                        {
                            action: "reply",
                            title: "Reply 💬",
                        },
                        {
                            action: "open",
                            title: "Open Duo",
                        },
                    ],
                },
                fcmOptions: {
                    link: deepLink,
                },
            },
        });
        console.log(`[PushDispatcher] Sent ${response.successCount}/${tokens.length} pushes for notif ${notifId}`);
        // 4. Prune stale / unregistered tokens
        const deletePromises = [];
        response.responses.forEach((resp, idx) => {
            if (!resp.success && resp.error) {
                const code = resp.error.code;
                if (code === "messaging/registration-token-not-registered" ||
                    code === "messaging/invalid-registration-token") {
                    const staleToken = tokens[idx];
                    const docId = tokenDocMap.get(staleToken);
                    if (docId) {
                        deletePromises.push(db
                            .collection("profiles")
                            .doc(recipientId)
                            .collection("devices")
                            .doc(docId)
                            .delete());
                    }
                }
            }
        });
        if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
            console.log(`[PushDispatcher] Pruned ${deletePromises.length} stale device tokens`);
        }
    }
    catch (err) {
        console.error(`[PushDispatcher] Error dispatching push for notif ${notifId}:`, err);
    }
});
/**
 * Trigger: When a call document is created in couples/{coupleId}/calls/{callId}
 * Dispatches high-urgency ringing call alert to the callee.
 */
exports.onCallCreated = (0, firestore_1.onDocumentCreated)("couples/{coupleId}/calls/{callId}", async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const call = snap.data();
    if (call.status !== "ringing")
        return;
    const { coupleId, callId } = event.params;
    let calleeId = call.calleeId;
    try {
        if (!calleeId) {
            const coupleSnap = await db.collection("couples").doc(coupleId).get();
            if (coupleSnap.exists) {
                const members = coupleSnap.data()?.members || [];
                calleeId = members.find((m) => m !== call.callerId) || null;
            }
        }
        if (!calleeId)
            return;
        const devicesSnap = await db
            .collection("profiles")
            .doc(calleeId)
            .collection("devices")
            .get();
        if (devicesSnap.empty)
            return;
        const tokens = [];
        devicesSnap.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.token && typeof data.token === "string") {
                tokens.push(data.token);
            }
        });
        if (tokens.length === 0)
            return;
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
    }
    catch (err) {
        console.error(`[CallPush] Error dispatching call push:`, err);
    }
});
/**
 * HTTP Endpoint: Notification action handler
 */
exports.notificationAction = (0, https_1.onRequest)({ cors: true, invoker: "public" }, async (req, res) => {
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
        }
        catch (err) {
            res.status(500).json({ error: err.message });
            return;
        }
    }
    res.status(200).json({ success: true });
});
// ─────────────────────────────────────────────────────────────────
// LiveKit Token Helper & Activity Sessions (LiveKit Cloud)
// ─────────────────────────────────────────────────────────────────
async function createLiveKitTokenForUser(params) {
    const apiKey = getSecretVal(livekitApiKeySecret, "LIVEKIT_API_KEY");
    const apiSecret = getSecretVal(livekitApiSecretSecret, "LIVEKIT_API_SECRET");
    const serverUrl = getSecretVal(livekitUrlSecret, "LIVEKIT_URL") || "wss://av-space-cgq1lsbg.livekit.cloud";
    if (!apiKey || !apiSecret) {
        console.warn("[LiveKit] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not set in environment.");
        return { token: "", serverUrl };
    }
    const at = new livekit_server_sdk_1.AccessToken(apiKey, apiSecret, {
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
        canPublishSources: [livekit_server_sdk_1.TrackSource.CAMERA, livekit_server_sdk_1.TrackSource.MICROPHONE, livekit_server_sdk_1.TrackSource.SCREEN_SHARE, livekit_server_sdk_1.TrackSource.SCREEN_SHARE_AUDIO],
        roomAdmin: params.isHost,
    });
    const token = await at.toJwt();
    return { token, serverUrl };
}
/**
 * Callable Cloud Function: Issues a secure, short-lived LiveKit token.
 * Verifies authenticated caller, couple membership, and room membership.
 */
exports.getLiveKitToken = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to request a media token.");
    }
    const uid = request.auth.uid;
    const { roomId, coupleId } = request.data || {};
    if (!roomId || !coupleId) {
        throw new https_1.HttpsError("invalid-argument", "Missing roomId or coupleId.");
    }
    // 1. Verify caller belongs to the couple
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Couple space not found.");
    }
    const coupleData = coupleSnap.data();
    const members = coupleData?.members || [];
    if (!members.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "Unauthorized: caller does not belong to this couple space.");
    }
    // 2. Authoritative room verification: require existing, open room with verified membership
    const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
    if (!roomSnap.exists) {
        throw new https_1.HttpsError("not-found", "Together room not found. Cannot issue media token.");
    }
    const rData = roomSnap.data();
    if (rData.status === "ended") {
        throw new https_1.HttpsError("failed-precondition", "This media room has already ended.");
    }
    if (rData.coupleId !== coupleId) {
        throw new https_1.HttpsError("permission-denied", "Unauthorized: room does not match couple space.");
    }
    const memberUids = rData.memberUids || [];
    if (!memberUids.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "Unauthorized: caller is not in this room's member list.");
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
        throw new https_1.HttpsError("internal", "Failed to issue LiveKit token. Verify server secrets.");
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
exports.sendPushNotification = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [oneSignalRestApiKeySecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const uid = request.auth.uid;
    const { coupleId, targetUserId, title, body, type, deepLink, metadata } = request.data || {};
    if (!coupleId || !targetUserId || !title) {
        throw new https_1.HttpsError("invalid-argument", "Missing required push notification parameters.");
    }
    // Verify sender and recipient belong to the verified couple
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Couple space not found.");
    }
    const members = coupleSnap.data()?.members || [];
    if (!members.includes(uid) || !members.includes(targetUserId)) {
        throw new https_1.HttpsError("permission-denied", "Unauthorized push target or sender.");
    }
    const oneSignalApiKey = getSecretVal(oneSignalRestApiKeySecret, "ONESIGNAL_REST_API_KEY");
    const oneSignalAppId = process.env.ONESIGNAL_APP_ID || "fa8f0dbb-1361-4fa3-b1d7-2f3b95d038dc";
    if (!oneSignalApiKey || !oneSignalAppId) {
        console.warn("[OneSignal Server] ONESIGNAL_REST_API_KEY not configured in environment secrets.");
        return { success: false, reason: "Server push secret not configured" };
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
            ...(metadata || {}),
        },
    };
    try {
        const resp = await fetch("https://api.onesignal.com/notifications", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader,
            },
            body: JSON.stringify(payload),
        });
        if (!resp.ok) {
            console.warn("[OneSignal Server] HTTP status:", resp.status, await resp.text());
            return { success: false, status: resp.status };
        }
        return { success: true };
    }
    catch (err) {
        console.error("[OneSignal Server] Error sending push:", err.message);
        return { success: false, error: err.message };
    }
});
/**
 * Creates an activity session (study | movie) in Firestore with LiveKit Cloud media.
 * Dispatches a polite non-ringing room invitation push notification to the partner.
 */
exports.startActivitySession = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to start a session.");
    }
    const uid = request.auth.uid;
    const { coupleId, type, initialTitle } = request.data || {};
    if (!coupleId || !type || (type !== "study" && type !== "movie")) {
        throw new https_1.HttpsError("invalid-argument", "Invalid session parameters. Must provide coupleId and type ('study' | 'movie').");
    }
    // 1. Verify caller belongs to the couple
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Couple space not found.");
    }
    const coupleData = coupleSnap.data();
    const members = coupleData?.members || [];
    if (!members.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "You do not belong to this couple space.");
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
    const sessionDoc = {
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
    }
    else {
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
            const tokens = [];
            devicesSnap.forEach((d) => {
                const token = d.data()?.token;
                if (token && typeof token === "string")
                    tokens.push(token);
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
        }
        catch (pushErr) {
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
exports.joinActivitySession = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to join a session.");
    }
    const uid = request.auth.uid;
    const { coupleId, sessionId } = request.data || {};
    if (!coupleId || !sessionId) {
        throw new https_1.HttpsError("invalid-argument", "Missing coupleId or sessionId.");
    }
    // 1. Verify user belongs to couple
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Couple space not found.");
    }
    const members = coupleSnap.data()?.members || [];
    if (!members.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "You do not belong to this couple space.");
    }
    // 2. Read stored session
    const sessionSnap = await db
        .collection("couples")
        .doc(coupleId)
        .collection("sessions")
        .doc(sessionId)
        .get();
    if (!sessionSnap.exists) {
        throw new https_1.HttpsError("not-found", "Session not found.");
    }
    const session = sessionSnap.data();
    if (!session || session.status !== "open") {
        throw new https_1.HttpsError("failed-precondition", "This session has already ended.");
    }
    if (session.expiresAt && session.expiresAt.toMillis() < Date.now()) {
        throw new https_1.HttpsError("failed-precondition", "This session has expired.");
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
exports.endActivitySession = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const uid = request.auth.uid;
    const { coupleId, sessionId } = request.data || {};
    if (!coupleId || !sessionId) {
        throw new https_1.HttpsError("invalid-argument", "Missing parameters.");
    }
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists || !coupleSnap.data()?.members?.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "Unauthorized.");
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
exports.createTogetherRoom = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to create a room.");
    }
    const uid = request.auth.uid;
    const { type, initialTitle } = request.data || {};
    if (!type || (type !== "study" && type !== "movie")) {
        throw new https_1.HttpsError("invalid-argument", "Room type must be 'study' or 'movie'.");
    }
    // Look up user's profile to find couple
    const profileSnap = await db.collection("profiles").doc(uid).get();
    const profileData = profileSnap.data();
    const coupleId = profileData?.coupleId;
    if (!coupleId) {
        throw new https_1.HttpsError("failed-precondition", "You must be paired in a couple space to create a together room.");
    }
    // Look up trusted couple record
    const coupleSnap = await db.collection("couples").doc(coupleId).get();
    if (!coupleSnap.exists) {
        throw new https_1.HttpsError("not-found", "Couple space record not found.");
    }
    const coupleData = coupleSnap.data();
    const members = coupleData?.members || [];
    if (!members.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "You are not a member of this couple space.");
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
        }
        else {
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
    const roomDoc = {
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
            const tokens = [];
            devicesSnap.forEach((d) => {
                const t = d.data()?.token;
                if (t && typeof t === "string")
                    tokens.push(t);
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
        }
        catch (e) {
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
exports.joinTogetherRoom = (0, https_1.onCall)({
    cors: true,
    invoker: "public",
    secrets: [livekitUrlSecret, livekitApiKeySecret, livekitApiSecretSecret],
}, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in to join a room.");
    }
    const uid = request.auth.uid;
    const { roomId } = request.data || {};
    if (!roomId) {
        throw new https_1.HttpsError("invalid-argument", "Missing roomId.");
    }
    const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
    if (!roomSnap.exists) {
        throw new https_1.HttpsError("not-found", "Together room not found.");
    }
    const roomData = roomSnap.data();
    if (roomData.status === "ended") {
        throw new https_1.HttpsError("failed-precondition", "This together room has already ended.");
    }
    const memberUids = roomData.memberUids || [];
    if (!memberUids.includes(uid)) {
        throw new https_1.HttpsError("permission-denied", "You are not an authorized member of this room.");
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
exports.endTogetherRoom = (0, https_1.onCall)({ cors: true, invoker: "public" }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be signed in.");
    }
    const uid = request.auth.uid;
    const { roomId } = request.data || {};
    if (!roomId) {
        throw new https_1.HttpsError("invalid-argument", "Missing roomId.");
    }
    const roomSnap = await db.collection("togetherRooms").doc(roomId).get();
    if (!roomSnap.exists) {
        throw new https_1.HttpsError("not-found", "Room not found.");
    }
    const roomData = roomSnap.data();
    if (roomData.hostUid !== uid) {
        throw new https_1.HttpsError("permission-denied", "Only the room host can end this together room.");
    }
    await roomSnap.ref.update({
        status: "ended",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedBy: uid,
        revision: admin.firestore.FieldValue.increment(1),
    });
    return { success: true };
});
//# sourceMappingURL=index.js.map