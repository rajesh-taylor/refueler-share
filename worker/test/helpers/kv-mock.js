// test/helpers/kv-mock.js
// Lightweight in-memory KV that matches the CF KV API surface used by
// ratelimit.js: get(key, {type:'json'}), put(key, value, {expirationTtl}).
//
// Also used by S61+ for any module that touches STATUS_KV.
//
// Not a complete KV implementation — covers only what our modules call.

export function makeKv() {
  const store = new Map();
  const meta  = new Map();   // key → { metadata, expirationTtl } (put options)

  return {
    // Expose the underlying store for test assertions
    _store: store,
    _meta:  meta,

    // list({ prefix, limit, cursor }) — lexicographic, as KV; metadata included.
    async list({ prefix = '', limit = 1000, cursor } = {}) {
      const names = [...store.keys()].filter(k => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page  = names.slice(start, start + limit);
      const done  = start + limit >= names.length;
      return {
        keys: page.map(name => ({ name, metadata: meta.get(name)?.metadata })),
        list_complete: done,
        cursor: done ? undefined : String(start + limit),
      };
    },

    async get(key, opts = {}) {
      const entry = store.get(key);
      if (entry === undefined) return null;

      if (opts.type === 'json') {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      }
      return entry;
    },

    async put(key, value, opts = {}) {
      // expirationTtl is noted (in _meta) but not enforced in tests — we control
      // time via Date manipulation rather than actual TTL expiry.
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
      meta.set(key, { metadata: opts.metadata, expirationTtl: opts.expirationTtl });
    },

    async delete(key) {
      store.delete(key);
      meta.delete(key);
    },

    // Simulate a KV read failure for error-path tests
    simulateReadError(key) {
      store.set(key, '!INVALID_JSON!{{{');
      // get() will JSON.parse this and throw → ratelimit catches and fails open
    },

    // Hard-wire a put error by replacing put with a thrower
    simulatePutError() {
      this.put = async () => { throw new Error('KV put failure'); };
    },

    clear() {
      store.clear();
    },
  };
}

// makeEnv() returns a minimal Worker env object for tests.
// Pass overrides to test missing-KV or degraded-KV scenarios.
export function makeEnv(overrides = {}) {
  return {
    STATUS_KV: makeKv(),
    ...overrides,
  };
}
