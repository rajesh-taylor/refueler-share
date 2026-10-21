// test/helpers/transfer-request.js — UUID-Out-Of-Path-1 · 21 Oct 2026.
//
// A request to a transfer route as the app now sends it: the URL is the fixed path
// (/meta, /download, /upload/finalise …) and the transfer UUID rides X-Transfer-UUID,
// the part number X-Part. Nothing that names a transfer goes in the path.

export function transferRequest(url, uuid, init = {}, part = null) {
  const headers = new Headers(init.headers ?? {});
  headers.set('X-Transfer-UUID', uuid);
  if (part !== null) headers.set('X-Part', String(part).padStart(4, '0'));
  return new Request(url, { ...init, headers });
}
