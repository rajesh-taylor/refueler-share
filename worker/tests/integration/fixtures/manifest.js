const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * makeManifest({ uuid, totalChunks, tier, passphrase? })
 * Returns a valid manifest object suitable for PUT /upload/{uuid}/manifest.json
 */
export function makeManifest({ uuid, totalChunks = 3, tier = 'free', passphrase = null }) {
  const now = Math.floor(Date.now() / 1000);
  const manifest = {
    uuid,
    total_chunks: totalChunks,
    tier,
    expiry_timestamp: now + SEVEN_DAYS,
    filename: 'test-file.bin',
    file_size: totalChunks * 1024 * 512,
    content_type: 'application/octet-stream',
    created_at: now,
  };
  if (passphrase) {
    // SHA-256 of passphrase as hex — mirrors what the frontend does
    manifest.p2sh_secret_hash = 'placeholder-hash-' + passphrase;
  }
  return manifest;
}

export function oversizeManifest(uuid) {
  const base = makeManifest({ uuid, totalChunks: 1 });
  // Pad to >64 KB
  base.padding = 'x'.repeat(65 * 1024);
  return base;
}

export function expiredManifest(uuid) {
  const m = makeManifest({ uuid });
  m.expiry_timestamp = Math.floor(Date.now() / 1000) - 1; // 1 second ago
  return m;
}


//
