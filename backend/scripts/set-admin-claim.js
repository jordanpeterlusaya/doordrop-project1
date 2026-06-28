#!/usr/bin/env node

const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

const { config } = require('../config');

const email = String(process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();

function initializeFirebaseAdmin() {
  if (getApps().length) {
    return;
  }

  const options = {
    projectId: config.firebaseProjectId || config.firebaseServiceAccount?.project_id,
  };

  if (config.firebaseServiceAccount) {
    options.credential = cert(config.firebaseServiceAccount);
  }

  initializeApp(options);
}

async function main() {
  if (!email) {
    throw new Error('Usage: node backend/scripts/set-admin-claim.js admin@example.com');
  }

  initializeFirebaseAdmin();

  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const nextClaims = {
    ...(user.customClaims || {}),
    admin: true,
  };

  await auth.setCustomUserClaims(user.uid, nextClaims);
  await auth.revokeRefreshTokens(user.uid);

  const updatedUser = await auth.getUser(user.uid);
  console.log(`Admin claim set for ${updatedUser.email} (${updatedUser.uid}).`);
  console.log(`Claims: ${JSON.stringify(updatedUser.customClaims || {})}`);
  console.log('Log out and log back in so the browser receives a fresh ID token.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
