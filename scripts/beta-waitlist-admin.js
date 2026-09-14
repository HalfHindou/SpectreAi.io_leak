#!/usr/bin/env node
/* eslint-disable no-console */
// One-off admin tool for the new-era-beta-waitlist Firestore collection.
//
// Usage:
//   node scripts/beta-waitlist-admin.js find <email>
//   node scripts/beta-waitlist-admin.js set-telegram <email> <@handle>
//   node scripts/beta-waitlist-admin.js upsert <email> [--telegram @handle] [--source manual-add]
//
// Auth: set GOOGLE_APPLICATION_CREDENTIALS to the service-account JSON path.

const path = require('path');
const admin = require(path.join(__dirname, 'firebase-tool', 'node_modules', 'firebase-admin'));

const COLLECTION = 'new-era-beta-waitlist';

function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

function parseArgs(argv) {
  const [, , cmd, ...rest] = argv;
  const positional = [];
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[i + 1] : 'true';
      flags[key] = val;
      if (val !== 'true') i += 1;
    } else {
      positional.push(a);
    }
  }
  return { cmd, positional, flags };
}

async function findByEmail(db, email) {
  const snap = await db.collection(COLLECTION).where('email', '==', email).get();
  return snap.docs;
}

async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    die('GOOGLE_APPLICATION_CREDENTIALS env var is required (path to service-account JSON).');
  }
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  const db = admin.firestore();

  const { cmd, positional, flags } = parseArgs(process.argv);

  if (cmd === 'find') {
    const email = positional[0];
    if (!email) die('Usage: find <email>');
    const docs = await findByEmail(db, email);
    if (docs.length === 0) {
      console.log(JSON.stringify({ email, found: false }, null, 2));
    } else {
      console.log(JSON.stringify(
        docs.map((d) => ({ id: d.id, ...d.data() })),
        (k, v) => (v && v.toDate ? v.toDate().toISOString() : v),
        2,
      ));
    }
    return;
  }

  if (cmd === 'set-telegram') {
    const [email, handle] = positional;
    if (!email || !handle) die('Usage: set-telegram <email> <@handle>');
    const docs = await findByEmail(db, email);
    if (docs.length === 0) die(`No doc found for ${email}`);
    for (const d of docs) {
      await d.ref.update({
        telegram: handle,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`updated ${d.id}: telegram=${handle}`);
    }
    return;
  }

  if (cmd === 'upsert') {
    const email = positional[0];
    if (!email) die('Usage: upsert <email> [--telegram @handle] [--source manual-add]');
    const docs = await findByEmail(db, email);
    const payload = {
      email,
      telegram: flags.telegram || null,
      source: flags.source || 'manual-add',
      status: flags.status || 'pending',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (docs.length === 0) {
      const ref = await db.collection(COLLECTION).add({
        ...payload,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`created ${ref.id}:`, payload);
    } else {
      for (const d of docs) {
        await d.ref.set(payload, { merge: true });
        console.log(`merged ${d.id}:`, payload);
      }
    }
    return;
  }

  die('Unknown command. Use: find | set-telegram | upsert');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
