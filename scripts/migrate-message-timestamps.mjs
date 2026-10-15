#!/usr/bin/env node
/**
 * Safe, idempotent, resumable migration script to backfill message timestamps in Cloud Firestore.
 * 
 * Usage:
 *   node scripts/migrate-message-timestamps.mjs [--dry-run] [--couple-id <id>]
 * 
 * Flags:
 *   --dry-run          Inspect and report without modifying any documents.
 *   --couple-id <id>   Migrate messages for a specific couple space only.
 * 
 * Environment variables:
 *   GOOGLE_APPLICATION_CREDENTIALS: Path to serviceAccountKey.json
 *   FIREBASE_SERVICE_ACCOUNT_KEY: Raw JSON string of service account key
 */

import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import process from 'process';

const projectId = process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'duo-couples-app-8910';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Usage: node scripts/migrate-message-timestamps.mjs [options]

Options:
  --dry-run          Inspect and report changes without modifying documents.
  --couple-id <id>   Run migration for a specific couple space only.
  --help, -h         Show this help message.

Authentication:
  Set GOOGLE_APPLICATION_CREDENTIALS to your service account key path, or
  run 'gcloud auth application-default login' before executing.
`);
  process.exit(0);
}

const isDryRun = args.includes('--dry-run');
const coupleIdIndex = args.indexOf('--couple-id');
const targetCoupleId = coupleIdIndex !== -1 ? args[coupleIdIndex + 1] : null;

let _db = null;
function getDb() {
  if (_db) return _db;
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      try {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
        initializeApp({ credential: cert(sa), projectId });
      } catch {
        initializeApp({ projectId });
      }
    } else {
      initializeApp({ projectId });
    }
  }
  _db = getFirestore();
  return _db;
}

function parseTimestampFromData(data, docId) {
  const parseVal = (val) => {
    if (!val) return null;
    if (typeof val.toMillis === 'function') {
      const ms = val.toMillis();
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (typeof val.seconds === 'number' && val.seconds > 0) {
      const ms = val.seconds * 1000 + (val.nanoseconds ? Math.round(val.nanoseconds / 1e6) : 0);
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (typeof val._seconds === 'number' && val._seconds > 0) {
      const ms = val._seconds * 1000 + (val._nanoseconds ? Math.round(val._nanoseconds / 1e6) : 0);
      if (!isNaN(ms) && ms > 0) return ms;
    }
    if (typeof val === 'number' && !isNaN(val) && val > 0) {
      return val > 1e9 && val < 1e11 ? val * 1000 : val;
    }
    if (typeof val === 'string') {
      const parsed = new Date(val).getTime();
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return null;
  };

  // 1. Existing createdAt
  const fromCreatedAt = parseVal(data.createdAt);
  if (fromCreatedAt) return fromCreatedAt;

  // 2. Existing created_at (ISO string)
  const fromCreatedAtSnake = parseVal(data.created_at);
  if (fromCreatedAtSnake) return fromCreatedAtSnake;

  // 3. Existing clientTimestamp
  if (typeof data.clientTimestamp === 'number' && !isNaN(data.clientTimestamp) && data.clientTimestamp > 0) {
    return data.clientTimestamp;
  }

  // 4. Existing timestamp
  const fromTimestamp = parseVal(data.timestamp);
  if (fromTimestamp) return fromTimestamp;

  // 5. From ID prefix (msg-1760000000000)
  const idToCheck = data.clientId || docId;
  if (typeof idToCheck === 'string' && idToCheck.startsWith('msg-')) {
    const parts = idToCheck.split('-');
    const ts = parseInt(parts[1], 10);
    if (!isNaN(ts) && ts > 1e11) return ts;
  }

  return null;
}

async function migrateCoupleMessages(coupleId) {
  const db = getDb();
  console.log(`\nChecking messages for couple: ${coupleId}...`);
  const messagesRef = db.collection('couples').doc(coupleId).collection('messages');
  const snap = await messagesRef.get();

  if (snap.empty) {
    console.log(`  No messages found in couple ${coupleId}.`);
    return { total: 0, updated: 0, valid: 0, skipped: 0 };
  }

  console.log(`  Found ${snap.size} message(s). Analyzing timestamp schemas...`);

  let valid = 0;
  let updated = 0;
  let skipped = 0;

  const BATCH_SIZE = 400;
  let currentBatch = db.batch();
  let pendingInBatch = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const hasCreatedAt = Boolean(data.createdAt && typeof data.createdAt.toMillis === 'function');
    const hasCreatedAtSnake = typeof data.created_at === 'string' && data.created_at.length > 0;
    const hasClientTs = typeof data.clientTimestamp === 'number' && data.clientTimestamp > 0;

    if (hasCreatedAt && hasCreatedAtSnake && hasClientTs) {
      valid++;
      continue;
    }

    const resolvedMs = parseTimestampFromData(data, docSnap.id);
    if (!resolvedMs) {
      console.warn(`  [Warning] Cannot derive timestamp for message ${docSnap.id}. Keeping unchanged.`);
      skipped++;
      continue;
    }

    const updates = {};
    if (!hasCreatedAt) {
      updates.createdAt = Timestamp.fromMillis(resolvedMs);
    }
    if (!hasCreatedAtSnake) {
      updates.created_at = new Date(resolvedMs).toISOString();
    }
    if (!hasClientTs) {
      updates.clientTimestamp = resolvedMs;
    }

    if (Object.keys(updates).length > 0) {
      if (isDryRun) {
        console.log(`  [DRY RUN] Would update doc ${docSnap.id}:`, updates);
      } else {
        currentBatch.update(docSnap.ref, updates);
        pendingInBatch++;

        if (pendingInBatch >= BATCH_SIZE) {
          await currentBatch.commit();
          console.log(`  Committed batch of ${pendingInBatch} updates.`);
          currentBatch = db.batch();
          pendingInBatch = 0;
        }
      }
      updated++;
    } else {
      valid++;
    }
  }

  if (!isDryRun && pendingInBatch > 0) {
    await currentBatch.commit();
    console.log(`  Committed final batch of ${pendingInBatch} updates.`);
  }

  console.log(`  Couple ${coupleId} summary: ${valid} already valid, ${updated} backfilled, ${skipped} skipped.`);
  return { total: snap.size, updated, valid, skipped };
}

async function run() {
  console.log('====================================================');
  console.log(' DUO Message Timestamp Migration & Backfill Tool   ');
  console.log(` Mode: ${isDryRun ? 'DRY RUN (no database writes)' : 'LIVE EXECUTION'}`);
  console.log('====================================================');

  try {
    const db = getDb();
    let coupleIds = [];
    if (targetCoupleId) {
      coupleIds = [targetCoupleId];
    } else {
      const couplesSnap = await db.collection('couples').get();
      coupleIds = couplesSnap.docs.map((d) => d.id);
    }

    console.log(`Targeting ${coupleIds.length} couple space(s)...`);

    let grandTotal = 0;
    let grandUpdated = 0;
    let grandValid = 0;

    for (const cId of coupleIds) {
      const res = await migrateCoupleMessages(cId);
      grandTotal += res.total;
      grandUpdated += res.updated;
      grandValid += res.valid;
    }

    console.log('\n====================================================');
    console.log(' Migration Finished Successfully');
    console.log(` Total messages scanned: ${grandTotal}`);
    console.log(` Validated as compliant:  ${grandValid}`);
    console.log(` Backfilled with updates: ${grandUpdated}`);
    console.log('====================================================');
    process.exit(0);
  } catch (err) {
    if (err?.message?.includes('Could not load the default credentials')) {
      console.error('\n[Authentication Required] No Google Cloud credentials found.');
      console.error('To run this script against your live Firebase database, please provide credentials:');
      console.error('  Option A (Service Account Key):');
      console.error('    $env:GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"');
      console.error('    node scripts/migrate-message-timestamps.mjs --dry-run');
      console.error('  Option B (Google Cloud CLI ADC):');
      console.error('    gcloud auth application-default login');
      console.error('    node scripts/migrate-message-timestamps.mjs --dry-run\n');
    } else {
      console.error('\nFatal migration error:', err);
    }
    process.exit(1);
  }
}

run();
