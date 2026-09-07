#!/usr/bin/env python3
"""
Propbook Deploy — ONE script for the whole flow.
Run after every React build.

What it does:
  1. Upload bundle (index.js + index.css) to /dev/assets/ on server (overwrites)
  2. Update ALL site HTML files to point to /dev/assets/
  3. Delete garbage test folders
  4. Clean orphaned hash-based JS/CSS from site folders
"""
import subprocess, os, json, base64, re, ssl, time

# ─── CONFIG ───────────────────────────────────────────────────
HOST = "u805830916@82.29.86.252"
PORT = 65002
PASS = "Clawbot12!"
BASE = "/home/u805830916/domains/propbook.pro/public_html"
DEV_DIR = f"{BASE}/dev/assets"
PROPS_DIR = f"{BASE}/props"
UPLOAD_URL = "https://www.propbook.pro/upload.php"
UPLOAD_SECRET = "propbook-deploy-2026"

# Garbage to delete
DELETE_SLUGS = [
    "fixdev-1788550149", "fixdev-1788550156", "fixdev-1788550166",
    "fixdev-1788550175", "fixns-1788551261",
]

# ─── HELPERS ──────────────────────────────────────────────────
def ssh(cmd, check=True):
    result = subprocess.run(
        f"sshpass -p '{PASS}' ssh -o StrictHostKeyChecking=no -o StrictHostKeyChecking=no -p {PORT} {HOST} \"{cmd}\"",
        shell=True, capture_output=True, text=True, timeout=30
    )
    out = result.stdout + result.stderr
    if result.returncode != 0 and check:
        print(f"  SSH warn: {out.strip()[:200]}")
    return out

def sftp_put(local_path, remote_path):
    code = subprocess.run(
        f"sshpass -p '{PASS}' sftp -o StrictHostKeyChecking=no -P {PORT} {HOST} <<EOF\nput {local_path} {remote_path}\nEOF",
        shell=True, capture_output=True, text=True, timeout=30
    ).returncode
    return code == 0

def http_upload(slug, files_b64):
    """Upload pre-encoded files via upload.php"""
    payload = json.dumps({
        "secret": UPLOAD_SECRET,
        "slug": slug,
        "files": files_b64
    }).encode()
    import urllib.request
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    req = urllib.request.Request(UPLOAD_URL, data=payload,
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30, context=ctx) as resp:
            return json.loads(resp.read().decode())
    except Exception as e:
        return {"error": str(e)}

def encode_b64(data):
    return base64.b64encode(data.encode()).decode()

# ─── STEP 1: Backup /dev/assets (ONE TIME only) ──────────────
backup_marker = f"{DEV_DIR}/.backup_done"
already = ssh(f"test -f {backup_marker} && echo YES || echo NO", check=False).strip()
if "NO" in already:
    ts = time.strftime("%Y%m%d%H%M%S")
    backup_dir = f"{BASE}/dev/assets_backup_{ts}"
    print(f"[1] One-time backup → {backup_dir}")
    ssh(f"cp -r {DEV_DIR} {backup_dir} && touch {backup_marker}")
    print("  ✅ Backup done, marker set")
else:
    print("[1] Backup already exists, skipping")

# ─── STEP 2: Build ────────────────────────────────────────────
print("\n[2] Building React app...")
proj = "/Users/davidsassistant/.openclaw/workspace/projects/propbook.dev"
result = subprocess.run(
    "npm run build", shell=True, cwd=proj,
    capture_output=True, text=True, timeout=120
)
if result.returncode != 0:
    print(f"  ❌ Build failed: {result.stderr[-300:]}")
    exit(1)
print(f"  ✅ Built in {proj}/src/dist/")
js_path = f"{proj}/src/dist/assets/index.js"
css_path = f"{proj}/src/dist/assets/index.css"
print(f"  JS: {os.path.getsize(js_path)//1024}KB, CSS: {os.path.getsize(css_path)//1024}KB")

# ─── STEP 3: Upload bundle to /dev/assets/ (overwrite) ────────
print("\n[3] Uploading bundle to /dev/assets/...")
ssh(f"mkdir -p {DEV_DIR}", check=False)
js_ok = sftp_put(js_path, f"{DEV_DIR}/index.js")
css_ok = sftp_put(css_path, f"{DEV_DIR}/index.css")
print(f"  index.js → {'✅' if js_ok else '❌'}")
print(f"  index.css → {'✅' if css_ok else '❌'}")

# Verify
verify = ssh(f"ls -la {DEV_DIR}/", check=False)
print(f"  Server /dev/assets/:\n{verify[:500]}")

# ─── STEP 4: Delete garbage sites ─────────────────────────────
print("\n[4] Deleting garbage sites...")
for slug in DELETE_SLUGS:
    target = f"{PROPS_DIR}/{slug}"
    out = ssh(f"rm -rf {target} 2>/dev/null; echo DONE", check=False)
    print(f"  Deleted {slug}")

# ─── STEP 5: Find all site HTML files ────────────────────────
print("\n[5] Finding all site HTML files...")
# Get list of folders in /props/
raw = ssh(f"ls {PROPS_DIR}/", check=False)
folders = [d.strip() for d in raw.splitlines() if d.strip()
           and not d.startswith('.')
           and not d.startswith('fix')
           and not d.startswith('paidredirect')
           and not d.startswith('temp')
           and d not in ['props', '_dev', 'dev']]
print(f"  Found {len(folders)} site folders: {', '.join(folders[:8])}...")

# ─── STEP 6: Update all site HTML files to use /dev/assets/ ───
print("\n[6] Updating HTML files to point to /dev/assets/...")
updated = 0
errors = 0
for slug in folders:
    html_path = f"{PROPS_DIR}/{slug}/index.html"
    # Fetch current HTML
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    import urllib.request
    try:
        req = urllib.request.Request(
            f"https://www.propbook.pro/props/{slug}/",
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=15, context=ctx) as resp:
            raw_html = resp.read()
            try:
                import gzip
                html = gzip.decompress(raw_html).decode('utf-8', errors='ignore')
            except:
                html = raw_html.decode('utf-8', errors='ignore')
    except Exception as e:
        print(f"  [{slug}] Fetch failed: {e}")
        errors += 1
        continue

    original = html

    # Replace ALL old asset patterns with /dev/assets/
    html = re.sub(r'/props/_dev/index-[^"]+\.js', '/dev/assets/index.js', html)
    html = re.sub(r'/dev/index-[^"]+\.js', '/dev/assets/index.js', html)
    html = re.sub(r'/props/_dev/dev/index-[^"]+\.css', '/dev/assets/index.css', html)
    html = re.sub(r'/props/_dev/index-[^"]+\.css', '/dev/assets/index.css', html)
    html = re.sub(r'/dev/index-[^"]+\.css', '/dev/assets/index.css', html)
    html = re.sub(r'/\_props/[a-zA-Z0-9_-]+/assets/index\.css', '/dev/assets/index.css', html)
    html = re.sub(r'/\_props/[a-zA-Z0-9_-]+/assets/index\.js', '/dev/assets/index.js', html)
    # Fix double-gzip path issue (some sites have /props/_dev/props/_dev/...)
    html = re.sub(r'/props/_dev/props/_dev/[^"]+', '/dev/assets/index.js', html)

    if html != original:
        print(f"  [{slug}] Updating...")
        result = http_upload(slug, {'index.html': encode_b64(html)})
        if result.get('success'):
            print(f"  [{slug}] ✅ Updated")
            updated += 1
        else:
            print(f"  [{slug}] ❌ {result.get('error', 'unknown')}")
            errors += 1
    else:
        # Also check for any remaining old-style src/href
        remaining = re.findall(r'/props/[^"]+\.(js|css)"', html)
        if remaining:
            print(f"  [{slug}] Still has old refs: {remaining[:3]}")
        # else: clean

print(f"\n  Summary: {updated} updated, {errors} errors")

# ─── STEP 7: Clean orphaned hash-files from site dirs ─────────
print("\n[7] Cleaning orphaned hash files from site folders...")
for slug in folders:
    ssh(f"find {PROPS_DIR}/{slug} -maxdepth 2 -name 'index-*.js' -delete -o -name 'index-*.css' -delete 2>/dev/null; echo OK", check=False)
print("  ✅ Done")

print(f"\n{'='*50}")
print("✅ Deploy complete!")
print(f"Bundle: /dev/assets/index.js ({os.path.getsize(js_path)//1024}KB)")
print(f"Sites updated: {updated}")
print("All sites now use the same /dev/assets/ bundle.")
print("\n📝 New sites: HTML auto-points to /dev/assets/")
print("📝 Existing sites: updated automatically above")
