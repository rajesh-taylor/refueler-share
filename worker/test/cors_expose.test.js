// Share-Soak-3 — download response headers readable from the browser.
// The Worker sent X-Integrity on every verified chunk, but CORS did not expose
// it, so test-upload.html's download-verify read "(absent)" and reported 5/5 fail.

import { describe, it, expect } from 'vitest';
import { corsHeaders } from '../src/utils.js';

describe('corsHeaders — Access-Control-Expose-Headers', () => {
  it('exposes X-Integrity and X-Chunk-Index alongside the existing headers', () => {
    const req = new Request('https://api.share.refueler.io/download/x/0000', { headers: { Origin: 'https://refueler.io' } });
    const exposed = corsHeaders(req)['Access-Control-Expose-Headers'].split(',').map(s => s.trim());
    expect(exposed).toEqual(expect.arrayContaining(['X-File-Name', 'X-Total-Bytes', 'X-Expiry-Timestamp', 'X-Integrity', 'X-Chunk-Index']));
  });
});
