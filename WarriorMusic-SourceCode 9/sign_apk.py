import os
import struct
import hashlib
import base64
import zipfile
from datetime import datetime, timezone, timedelta
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives.serialization import pkcs7

base_dir = r"C:\Users\Hp\.gemini\antigravity\scratch\novax-music-app"
apk_dir = os.path.join(base_dir, "apk_inspect")
output_apk = os.path.join(base_dir, "public", "downloads", "WarriorMusic.apk")
meta_dir = os.path.join(apk_dir, "META-INF")
os.makedirs(meta_dir, exist_ok=True)

# 1. Clean existing META-INF directory
for f in os.listdir(meta_dir):
    try:
        os.remove(os.path.join(meta_dir, f))
    except Exception:
        pass

# 2. Collect all files (excluding META-INF) and calculate SHA-256 for MANIFEST.MF
entries = {}
for root, dirs, files in os.walk(apk_dir):
    for f in files:
        full_path = os.path.join(root, f)
        rel_path = os.path.relpath(full_path, apk_dir).replace("\\", "/")
        if rel_path.upper().startswith("META-INF/"):
            continue
        with open(full_path, "rb") as fp:
            data = fp.read()
        digest = hashlib.sha256(data).digest()
        entries[rel_path] = base64.b64encode(digest).decode("ascii")

# 3. Create MANIFEST.MF
manifest_lines = ["Manifest-Version: 1.0\r\nCreated-By: 1.0 (Warrior Music)\r\n\r\n"]
for name in sorted(entries.keys()):
    manifest_lines.append(f"Name: {name}\r\nSHA-256-Digest: {entries[name]}\r\n\r\n")

manifest_bytes = "".join(manifest_lines).encode("utf-8")
with open(os.path.join(meta_dir, "MANIFEST.MF"), "wb") as fp:
    fp.write(manifest_bytes)

manifest_main_digest = base64.b64encode(hashlib.sha256(manifest_bytes).digest()).decode("ascii")

# 4. Create WARRIOR.SF
sf_lines = [
    "Signature-Version: 1.0\r\n",
    "Created-By: 1.0 (Warrior Music)\r\n",
    f"SHA-256-Digest-Manifest: {manifest_main_digest}\r\n\r\n"
]
for name in sorted(entries.keys()):
    entry_chunk = f"Name: {name}\r\nSHA-256-Digest: {entries[name]}\r\n\r\n".encode("utf-8")
    entry_digest = base64.b64encode(hashlib.sha256(entry_chunk).digest()).decode("ascii")
    sf_lines.append(f"Name: {name}\r\nSHA-256-Digest: {entry_digest}\r\n\r\n")

sf_bytes = "".join(sf_lines).encode("utf-8")
sf_path = os.path.join(meta_dir, "WARRIOR.SF")
with open(sf_path, "wb") as fp:
    fp.write(sf_bytes)

# 5. Generate RSA Key & X.509 Certificate
private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
subject = issuer = x509.Name([
    x509.NameAttribute(NameOID.COMMON_NAME, "Warrior Music"),
    x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Warrior Music"),
    x509.NameAttribute(NameOID.COUNTRY_NAME, "IN"),
])

cert = (
    x509.CertificateBuilder()
    .subject_name(subject)
    .issuer_name(issuer)
    .public_key(private_key.public_key())
    .serial_number(x509.random_serial_number())
    .not_valid_before(datetime.now(timezone.utc) - timedelta(days=1))
    .not_valid_after(datetime.now(timezone.utc) + timedelta(days=3650))
    .sign(private_key, hashes.SHA256())
)
cert_der = cert.public_bytes(serialization.Encoding.DER)
pubkey_der = private_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

# v1 WARRIOR.RSA (PKCS#7 detached signature)
builder = pkcs7.PKCS7SignatureBuilder().set_data(sf_bytes)
builder = builder.add_signer(cert, private_key, hashes.SHA256())
pkcs7_der = builder.sign(serialization.Encoding.DER, options=[pkcs7.PKCS7Options.DetachedSignature])
with open(os.path.join(meta_dir, "WARRIOR.RSA"), "wb") as fp:
    fp.write(pkcs7_der)

print("Generated valid v1 signature files.")

# 6. Build base ZIP with 4-byte alignment
temp_zip = output_apk + ".tmp"
if os.path.exists(temp_zip):
    os.remove(temp_zip)

def should_store(rel_name):
    if rel_name == "resources.arsc" or rel_name.endswith(".png"):
        return True
    return False

# Sort files: AndroidManifest.xml first, resources.arsc, assets/res, classes.dex, then META-INF
file_list = []
for root, dirs, files in os.walk(apk_dir):
    for f in files:
        full_path = os.path.join(root, f)
        rel_path = os.path.relpath(full_path, apk_dir).replace("\\", "/")
        if not rel_path.upper().startswith("META-INF/"):
            file_list.append(rel_path)

def sort_key(name):
    if name == "AndroidManifest.xml":
        return "000_" + name
    if name == "resources.arsc":
        return "001_" + name
    if name == "classes.dex":
        return "888_" + name
    return "500_" + name

file_list.sort(key=sort_key)
# Append META-INF files exactly once
file_list.extend(["META-INF/WARRIOR.SF", "META-INF/WARRIOR.RSA", "META-INF/MANIFEST.MF"])

with zipfile.ZipFile(temp_zip, "w") as zf:
    for rel_path in file_list:
        full_path = os.path.join(apk_dir, rel_path.replace("/", os.sep))
        with open(full_path, "rb") as fp:
            data = fp.read()
        
        zinfo = zipfile.ZipInfo(rel_path)
        zinfo.date_time = (2026, 1, 1, 0, 0, 0)
        
        if should_store(rel_path):
            zinfo.compress_type = zipfile.ZIP_STORED
            # Ensure uncompressed data starts at 4-byte boundary:
            # Header length: 30 bytes + len(filename) + len(extra)
            header_offset = zf.fp.tell()
            current_data_offset = header_offset + 30 + len(rel_path.encode("utf-8"))
            padding_len = (4 - (current_data_offset % 4)) % 4
            if padding_len > 0:
                zinfo.extra = b"\x00" * padding_len
        else:
            zinfo.compress_type = zipfile.ZIP_DEFLATED
        
        zf.writestr(zinfo, data)

print(f"Base ZIP constructed: {len(file_list)} files, {os.path.getsize(temp_zip)} bytes.")

# 7. Add APK Signature Scheme v2 Block
with open(temp_zip, "rb") as f:
    zip_bytes = bytearray(f.read())

eocd_pos = zip_bytes.rfind(b"\x50\x4b\x05\x06")
cd_records, cd_size, cd_offset = struct.unpack("<HII", zip_bytes[eocd_pos+10:eocd_pos+20])

sec1 = bytes(zip_bytes[:cd_offset])
sec2 = bytes(zip_bytes[cd_offset:cd_offset+cd_size])
sec3 = bytearray(zip_bytes[eocd_pos:eocd_pos+22])
sec3[16:20] = struct.pack("<I", cd_offset) # modified CD offset in Section 3

CHUNK_SIZE = 1048576
chunks = []
for sec in [sec1, sec2, bytes(sec3)]:
    for i in range(0, len(sec), CHUNK_SIZE):
        chunks.append(sec[i:i+CHUNK_SIZE])

chunk_digests = b"".join([hashlib.sha256(b"\xa5" + struct.pack("<I", len(c)) + c).digest() for c in chunks])
top_digest = hashlib.sha256(b"\x5a" + struct.pack("<I", len(chunks)) + chunk_digests).digest()
print(f"Calculated v2 top digest ({len(chunks)} chunks): {top_digest.hex()}")

# Build signed_data
# digests: sequence of len-prefixed digest entries
# entry: [len: 40] [algo: 0x0103] [digest_len: 32] [top_digest]
d_entry = struct.pack("<I", 4 + 4 + len(top_digest)) + struct.pack("<I", 0x0103) + struct.pack("<I", len(top_digest)) + top_digest
digests_seq = struct.pack("<I", len(d_entry)) + d_entry

# certs: sequence of len-prefixed cert entries
c_entry = struct.pack("<I", len(cert_der)) + cert_der
certs_seq = struct.pack("<I", len(c_entry)) + c_entry

# additional attributes: empty
attrs_seq = struct.pack("<I", 0)

signed_data = digests_seq + certs_seq + attrs_seq
signed_data_prefixed = struct.pack("<I", len(signed_data)) + signed_data

# Sign signed_data with RSA-PKCS1-v1_5
v2_signature = private_key.sign(signed_data, padding.PKCS1v15(), hashes.SHA256())
s_entry = struct.pack("<I", 4 + 4 + len(v2_signature)) + struct.pack("<I", 0x0103) + struct.pack("<I", len(v2_signature)) + v2_signature
signatures_seq = struct.pack("<I", len(s_entry)) + s_entry

pubkey_prefixed = struct.pack("<I", len(pubkey_der)) + pubkey_der

signer = signed_data_prefixed + signatures_seq + pubkey_prefixed
signer_prefixed = struct.pack("<I", len(signer)) + signer
signers_seq = struct.pack("<I", len(signer_prefixed)) + signer_prefixed

# Pair for v2: ID 0x7109871a
v2_pair = struct.pack("<QI", 4 + len(signers_seq), 0x7109871a) + signers_seq

# APK Signing Block
# Format: [uint64 size_excl] [pairs] [uint64 size_excl] [16 bytes magic: 'APK Sig Block 42']
block_size_excl = len(v2_pair) + 24
sig_block = struct.pack("<Q", block_size_excl) + v2_pair + struct.pack("<Q", block_size_excl) + b"APK Sig Block 42"

# Inject block before Central Directory & update EOCD CD offset
new_cd_offset = len(sec1) + len(sig_block)
final_eocd = bytearray(zip_bytes[eocd_pos:eocd_pos+22])
final_eocd[16:20] = struct.pack("<I", new_cd_offset)

final_apk_bytes = sec1 + sig_block + sec2 + bytes(final_eocd)

with open(output_apk, "wb") as f:
    f.write(final_apk_bytes)

if os.path.exists(temp_zip):
    os.remove(temp_zip)

print(f"Successfully generated v1+v2 signed APK at: {output_apk} (Size: {len(final_apk_bytes)} bytes)")
