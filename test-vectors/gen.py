#!/usr/bin/env python3
"""
test-vectors/gen.py — writes test-vectors/v1.json (H2 Browser-KAT-1, 4 Nov 2026).

Nothing here imports Share's code. Every expected value comes from one of:
  - Python `cryptography` (OpenSSL): AES-GCM, HKDF
  - Python `blake3` (the BLAKE3 team's Rust code), checked against their published vectors
  - hashlib, checked against FIPS 180 examples
  - the published Cashu vectors (cashubtc/nuts tests/00-tests.md, 12-tests.md), checked below
  - a few lines of secp256k1 arithmetic used ONLY here, which must reproduce those published
    vectors before anything is written (the app never runs this code)

Run in a throwaway venv, from anywhere:
  python3 -m venv /tmp/kv && /tmp/kv/bin/pip install cryptography blake3
  /tmp/kv/bin/python -I test-vectors/gen.py
Output is deterministic: every key, nonce and message is fixed. CI never runs this file.
"""
import base64
import hashlib
import json
import pathlib

import blake3 as py_blake3
import cryptography
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

OUT = pathlib.Path(__file__).resolve().parent / "v1.json"
CHUNK_SIZE = 32 * 1024 * 1024


def h(b):
    return bytes(b).hex()


def b64u(b):
    return base64.urlsafe_b64encode(bytes(b)).rstrip(b"=").decode()


def blob(obj):
    """The link's # part: compact JSON, UTF-8 (not \\u escapes), then base64url."""
    return b64u(json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode())


# ── Part encryption: HKDF → AES-256-GCM, counter nonce with a last flag ──────
INFO = b"refueler.share.payload.v2\x00"


def part_key(k):
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=b"", info=INFO).derive(k)


def nonce(i, last):
    return b"\x00" * 7 + i.to_bytes(4, "big") + (b"\x01" if last else b"\x00")


def aad(i):
    return i.to_bytes(4, "big")


def seal(key, i, n, pt):
    return AESGCM(key).encrypt(nonce(i, i == n - 1), pt, aad(i))


K = bytes(range(32))
K2 = hashlib.sha256(b"refueler share kat second key").digest()
PK, PK2 = part_key(K), part_key(K2)
P = [bytes(64), bytes(range(64)), b"refueler share v2 tail"]

cases = []
for i, pt in enumerate(P):
    cases.append(dict(name=f"part {i} of 3", key="K", i=i, n=3, pt=h(pt), nonce=h(nonce(i, i == 2)), aad=h(aad(i)), ct=h(seal(PK, i, 3, pt))))
cases.append(dict(name="single part: last flag on index 0", key="K", i=0, n=1, pt=h(P[2]), nonce=h(nonce(0, True)), aad=h(aad(0)), ct=h(seal(PK, 0, 1, P[2]))))
cases.append(dict(name="index past one byte: 256 of 300", key="K", i=256, n=300, pt=h(P[2]), nonce=h(nonce(256, False)), aad=h(aad(256)), ct=h(seal(PK, 256, 300, P[2]))))
cases.append(dict(name="largest transfer: last of 8000", key="K", i=7999, n=8000, pt=h(P[2]), nonce=h(nonce(7999, True)), aad=h(aad(7999)), ct=h(seal(PK, 7999, 8000, P[2]))))
cases.append(dict(name="empty plaintext", key="K2", i=0, n=1, pt="", nonce=h(nonce(0, True)), aad=h(aad(0)), ct=h(seal(PK2, 0, 1, b""))))

C = [bytes.fromhex(c["ct"]) for c in cases[:3]]
flipped = bytearray(C[0])
flipped[-1] ^= 1
direct_k = AESGCM(K).encrypt(nonce(0, False), P[0], aad(0))  # K itself, never the derived key
refuse = [
    dict(name="part 0 read as part 1 (reordered)", ct=h(C[0]), i=1, n=3),
    dict(name="part 1 read as part 0 (reordered)", ct=h(C[1]), i=0, n=3),
    dict(name="middle part read as the last (file cut short)", ct=h(C[1]), i=1, n=2),
    dict(name="last part read as a middle part (part added after it)", ct=h(C[2]), i=2, n=4),
    dict(name="tag changed", ct=h(flipped), i=0, n=3),
    dict(name="one byte missing", ct=h(C[0][:-1]), i=0, n=3),
    dict(name="encrypted under K, not the derived part key", ct=h(direct_k), i=0, n=3),
    dict(name="other transfer's key", ct=h(seal(PK2, 0, 3, P[0])), i=0, n=3),
]
big = seal(PK, 0, 2, bytes(CHUNK_SIZE))
V1_IV = bytes.fromhex("a1a2a3a4a5a6a7a8a9aaabac")
part = dict(
    k=h(K), k2=h(K2), info=h(INFO), part_key=h(PK), cases=cases, refuse=refuse,
    big=dict(name="full-size part: 32 MiB of zeros, index 0 of 2", plain_len=CHUNK_SIZE, ct_len=len(big), sha256=hashlib.sha256(big).hexdigest(), tag=h(big[-16:])),
    bad_k_lengths=[0, 16, 31, 33],
    v1=dict(name="links before v2: K directly, the link's IV, AAD = index", k=h(K), iv=h(V1_IV), i=3, pt=h(P[2]), ct=h(AESGCM(K).encrypt(V1_IV, P[2], aad(3)))),
)

# ── BLAKE3: the team's published vectors, input = bytes 0..250 repeating ─────
# Source: BLAKE3-team/BLAKE3 test_vectors/test_vectors.json (first 32 bytes of each `hash`)
PUBLISHED_B3 = {
    0: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
    1: "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
    1023: "10108970eeda3eb932baac1428c7a2163b0e924c9a9e25b35bba72b28f70bd11",
    1024: "42214739f095a406f3fc83deb889744ac00df831c10daa55189b5d121c855af7",
    1025: "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444",
    2048: "e776b6028c7cd22a4d0ba182a8bf62205d2ef576467e838ed6f2529b85fba24a",
    3072: "b98cb0ff3623be03326b373de6b9095218513e64f1ee2edd2525c7ad1e5cffd2",
    31744: "62b6960e1a44bcc1eb1a611a8d6235b6b4b78f32e7abc4fb4c6cdcce94895c47",
}


def b3_input(n):
    return bytes(i % 251 for i in range(n))


b3_cases = []
for n, published in PUBLISHED_B3.items():
    got = py_blake3.blake3(b3_input(n)).hexdigest()
    b3_cases.append(dict(input_len=n, hash=got, published=got == published))
ABC = "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"
assert py_blake3.blake3(b"abc").hexdigest() == ABC
blake3_section = dict(cases=b3_cases, abc=ABC)

# ── SHA-256: FIPS 180 examples, then hashlib agreeing ────────────────────────
FIPS = [
    (b"", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"),
    (b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
    (b"abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"),
]
sha_cases = []
for m, d in FIPS:
    assert hashlib.sha256(m).hexdigest() == d
    sha_cases.append(dict(msg=h(m), digest=d))
assert hashlib.sha256(b"a" * 1000000).hexdigest() == "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0"
sha_section = dict(cases=sha_cases, million_a="cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0")

# ── Link fragment ────────────────────────────────────────────────────────────
NAME_UNI = "Fürst 写真 📷 final.zip"
SEAL = bytes(range(16))
assemble = [
    dict(name="ascii", k=h(K), n="test.bin", z=33554455, s=None, blob=blob({"v": 2, "k": b64u(K), "n": "test.bin", "z": 33554455})),
    dict(name="non-ASCII name", k=h(K), n=NAME_UNI, z=1, s=None, blob=blob({"v": 2, "k": b64u(K), "n": NAME_UNI, "z": 1})),
    dict(name="with a seal nonce (key order v k n s z)", k=h(K2), n="a b.txt", z=9007199254740991, s=h(SEAL), blob=blob({"v": 2, "k": b64u(K2), "n": "a b.txt", "s": b64u(SEAL), "z": 9007199254740991})),
]
k31, k33 = b64u(K[:31]), b64u(K + b"\x00")
parse_refuse = [
    dict(name="v2 key 31 bytes", blob=blob({"v": 2, "k": k31, "n": "a", "z": 1})),
    dict(name="v2 key 33 bytes", blob=blob({"v": 2, "k": k33, "n": "a", "z": 1})),
    dict(name="v2 key missing", blob=blob({"v": 2, "n": "a", "z": 1})),
    dict(name="v2 key not text", blob=blob({"v": 2, "k": 7, "n": "a", "z": 1})),
    dict(name="v2 name empty", blob=blob({"v": 2, "k": b64u(K), "n": "", "z": 1})),
    dict(name="v2 name missing", blob=blob({"v": 2, "k": b64u(K), "z": 1})),
    dict(name="v2 size zero", blob=blob({"v": 2, "k": b64u(K), "n": "a", "z": 0})),
    dict(name="v2 size negative", blob=blob({"v": 2, "k": b64u(K), "n": "a", "z": -1})),
    dict(name="v2 size not whole", blob=blob({"v": 2, "k": b64u(K), "n": "a", "z": 1.5})),
    dict(name="v2 size missing", blob=blob({"v": 2, "k": b64u(K), "n": "a"})),
    dict(name="v2 size past safe integers", blob=blob({"v": 2, "k": b64u(K), "n": "a", "z": 9007199254740992})),
    dict(name="v2 empty seal nonce", blob=blob({"v": 2, "k": b64u(K), "n": "a", "s": "", "z": 1})),
    dict(name="v1 key missing", blob=blob({"v": 1, "n": "a"})),
    dict(name="v1 name missing", blob=blob({"v": 1, "k": b64u(K)})),
]
parse_ok = [
    dict(name="v1 with IV", blob=blob({"v": 1, "k": b64u(K), "n": "old.bin", "i": b64u(V1_IV)}), v=1, k=h(K), n="old.bin", iv=h(V1_IV), z=None, legacy=False),
    dict(name="v1 with a damaged size keeps the link", blob=blob({"v": 1, "k": b64u(K), "n": "old.bin", "z": "x"}), v=1, k=h(K), n="old.bin", iv=None, z=None, legacy=False),
    dict(name="legacy raw key", blob=b64u(K), v=None, k=h(K), n=None, iv=None, z=None, legacy=True),
]
fragment = dict(assemble=assemble, parse_ok=parse_ok, parse_refuse=parse_refuse)

# ── NUT-00 + NUT-12. Curve arithmetic for this generator only. ───────────────
FP = 2**256 - 2**32 - 977
FN = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798, 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


def add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % FP == 0:
        return None
    if a == b:
        m = 3 * a[0] * a[0] * pow(2 * a[1], -1, FP) % FP
    else:
        m = (b[1] - a[1]) * pow(b[0] - a[0], -1, FP) % FP
    x = (m * m - a[0] - b[0]) % FP
    return (x, (m * (a[0] - x) - a[1]) % FP)


def mul(k, p):
    r = None
    while k:
        if k & 1:
            r = add(r, p)
        p = add(p, p)
        k >>= 1
    return r


def neg(p):
    return (p[0], FP - p[1])


def comp(p):
    return (b"\x03" if p[1] & 1 else b"\x02") + p[0].to_bytes(32, "big")


def uncomp(p):
    return b"\x04" + p[0].to_bytes(32, "big") + p[1].to_bytes(32, "big")


def lift(x_bytes, prefix=2):
    x = int.from_bytes(x_bytes, "big")
    if x >= FP:
        return None
    y2 = (pow(x, 3, FP) + 7) % FP
    y = pow(y2, (FP + 1) // 4, FP)
    if y * y % FP != y2:
        return None
    if y & 1 != prefix & 1:
        y = FP - y
    return (x, y)


def point(hex_):
    b = bytes.fromhex(hex_)
    return lift(b[1:], b[0])


def hash_to_curve(msg):
    digest = hashlib.sha256(b"Secp256k1_HashToCurve_Cashu_" + msg).digest()
    for counter in range(2**16):
        p = lift(hashlib.sha256(digest + counter.to_bytes(4, "little")).digest())
        if p:
            return p
    raise ValueError("no point")


def hash_e(*points):
    return hashlib.sha256("".join(uncomp(p).hex() for p in points).encode()).digest()


# Published vectors. The arithmetic above must reproduce them or nothing is written.
H2C = [
    ("0000000000000000000000000000000000000000000000000000000000000000", "024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725"),
    ("0000000000000000000000000000000000000000000000000000000000000001", "022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf"),
    ("0000000000000000000000000000000000000000000000000000000000000002", "026cdbe15362df59cd1dd3c9c11de8aedac2106eca69236ecd9fbe117af897be4f"),
]
BLINDED = [
    ("d341ee4871f1f889041e63cf0d3823c713eea6aff01e80f1719f08f9e5be98f6", "99fce58439fc37412ab3468b73db0569322588f62fb3a49182d67e23d877824a", "033b1a9737a40cc3fd9b6af4b723632b76a67a36782596304612a6c2bfb5197e6d"),
    ("f1aaf16c2239746f369572c0784d9dd3d032d952c2d992175873fb58fae31a60", "f78476ea7cc9ade20f9e05e58a804cf19533f03ea805ece5fee88c8e2874ba50", "029bdf2d716ee366eddf599ba252786c1033f47e230248a4612a5670ab931f1763"),
]
SIGNED = [
    ("0000000000000000000000000000000000000000000000000000000000000001", "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2", "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2"),
    ("7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f7f", "02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2", "0398bc70ce8184d27ba89834d19f5199c84443c31131e48d3c1214db24247d005d"),
]
for m, pt in H2C:
    assert comp(hash_to_curve(bytes.fromhex(m))).hex() == pt
for x, r, b in BLINDED:
    assert comp(add(hash_to_curve(bytes.fromhex(x)), mul(int(r, 16), G))).hex() == b
for k_, b, c in SIGNED:
    assert comp(mul(int(k_, 16), point(b))).hex() == c
assert hash_e(point("020000000000000000000000000000000000000000000000000000000000000001"),
              point("020000000000000000000000000000000000000000000000000000000000000001"),
              point("020000000000000000000000000000000000000000000000000000000000000001"),
              point("02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2")).hex() == "a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e"

# Published NUT-12 DLEQ on a BlindSignature
PUB_DLEQ = dict(
    A="0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
    B_="02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2",
    C_="02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2",
    e="9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73d9",
    s="9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73da",
)

# Share's whole credential path with fixed values: secret string → B_ → C_ + DLEQ → C
MINT_K = int(hashlib.sha256(b"refueler share kat mint key, test only").hexdigest(), 16) % FN
MINT_PUB = mul(MINT_K, G)
SECRET = "5f1e" * 16  # 64 hex characters: its UTF-8 bytes go to the curve, as in the app
R = int(hashlib.sha256(b"refueler share kat blinding factor").hexdigest(), 16) % FN
Y = hash_to_curve(SECRET.encode())
B_ = add(Y, mul(R, G))
C_ = mul(MINT_K, B_)
D_R = int(hashlib.sha256(b"refueler share kat dleq nonce").hexdigest(), 16) % FN
E = hash_e(mul(D_R, G), mul(D_R, B_), MINT_PUB, C_)
S = (D_R + int.from_bytes(E, "big") * MINT_K) % FN
CRED_C = add(C_, neg(mul(R, MINT_PUB)))
assert CRED_C == mul(MINT_K, Y)
flow = dict(
    mint_k=f"{MINT_K:064x}", mint_pub=comp(MINT_PUB).hex(), secret=SECRET, r=f"{R:064x}", Y=comp(Y).hex(),
    B_=comp(B_).hex(), C_=comp(C_).hex(), e=E.hex(), s=f"{S:064x}", C=comp(CRED_C).hex(),
)
nut00 = dict(
    hash_to_curve=[dict(msg=m, point=p) for m, p in H2C],
    blinded=[dict(x=x, r=r, B_=b) for x, r, b in BLINDED],
    signed=[dict(k=k_, B_=b, C_=c) for k_, b, c in SIGNED],
    dleq_valid=PUB_DLEQ,
    dleq_invalid=dict(PUB_DLEQ, s="9818e061ee51d5c8edc3342369a554998ff7b4381c8652d724cdf46429be73db"),
    flow=flow,
)

out = dict(
    schema="refueler.share.kat.v1",
    generated_by=dict(script="test-vectors/gen.py", cryptography=cryptography.__version__, blake3=py_blake3.__version__),
    published_sources=dict(
        blake3="github.com/BLAKE3-team/BLAKE3 test_vectors/test_vectors.json",
        nut00="github.com/cashubtc/nuts tests/00-tests.md",
        nut12="github.com/cashubtc/nuts tests/12-tests.md",
        sha256="FIPS 180 examples",
    ),
    part=part, blake3=blake3_section, sha256=sha_section, fragment=fragment, nut00=nut00,
)
if not all(c["published"] for c in b3_cases):
    bad = [c["input_len"] for c in b3_cases if not c["published"]]
    raise SystemExit(f"BLAKE3 disagrees with the published vectors at lengths {bad}")
for c in b3_cases:
    del c["published"]
OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
print("wrote", OUT, "cases:", len(cases), "refuse:", len(refuse))
