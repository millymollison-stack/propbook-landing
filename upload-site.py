#!/usr/bin/env python3
"""
PropBook Site Upload — Upload HTML bundle and update site HTML with cache-busting version.
Usage: python3 upload-site.py <slug> [slug2 ...]

Required env vars (set in src/.env):
  FTP_HOST, FTP_PORT, FTP_USER, FTP_PASS, UPLOAD_SECRET
  UPLOAD_URL (optional, defaults to https://propbook.pro/upload.php)
"""
import subprocess, json, base64, re, os, sys

def _load_env(path):
    """Minimal .env loader — no external deps."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            os.environ.setdefault(k.strip(), v.strip())

_load_env(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'src', '.env'))

def _require(name):
    val = os.environ.get(name)
    if not val:
        raise RuntimeError(f"{name} not set — add it to src/.env")
    return val


FTP_HOST   = _require("FTP_HOST")
FTP_PORT   = _require("FTP_PORT")
FTP_USER   = _require("FTP_USER")
FTP_PASS   = _require("FTP_PASS")
UPLOAD_URL = os.environ.get("UPLOAD_URL", "https://propbook.pro/upload.php")
UPLOAD_SECRET = _require("UPLOAD_SECRET")
DEV_DIR   = f"/home/u805830916/domains/propbook.pro/public_html/dev/assets"

def ftp(cmd):
    """Run a single FTP command, return stdout+stderr."""
    result = subprocess.run(
        f'sshpass -p "{FTP_PASS}" sftp -o StrictHostKeyChecking=no -P {FTP_PORT} {FTP_USER}@{FTP_HOST} <<EOF\n{cmd}\nEOF',
        shell=True, capture_output=True, text=True, timeout=30
    )
    return result.stdout + result.stderr

def upload_file(local_path, remote_path):
    """Upload a single file via SCP to SFTP port."""
    code = subprocess.run(
        f'sshpass -p "{FTP_PASS}" scp -o StrictHostKeyChecking=no -P {FTP_PORT} "{local_path}" {FTP_USER}@{FTP_HOST}:{remote_path}',
        shell=True, capture_output=True, text=True, timeout=90
    )
    return code.returncode == 0

def upload_html(slug, html_content):
    """Upload index.html for a site via upload.php."""
    encoded = base64.b64encode(html_content.encode()).decode()
    payload = json.dumps({
        "secret": UPLOAD_SECRET,
        "slug": slug,
        "files": {"index.html": encoded}
    }).encode()
    with open("/tmp/ul_payload.json", "wb") as f:
        f.write(payload)
    result = subprocess.run(
        ["curl", "-sL", "-k", "-X", "POST", UPLOAD_URL,
         "-H", "Content-Type: application/json",
         "-d", "@/tmp/ul_payload.json"],
        capture_output=True, text=True, timeout=30
    )
    try:
        return json.loads(result.stdout)
    except:
        return {"error": result.stdout[:200]}

def get_version():
    """Read current BUNDLE_VERSION from bundle-versions.ts."""
    bv_path = os.path.join(os.path.dirname(__file__), "src/services/bundle-versions.ts")
    with open(bv_path) as f:
        content = f.read()
    m = re.search(r'BUNDLE_VERSION\s*=\s*["\']([^"\']+)["\']', content)
    return m.group(1) if m else None

def update_html(html, ver):
    """Add cache-busting ?v= to JS and CSS script links."""
    # JS (both absolute and protocol-relative)
    html = re.sub(
        r'<script type="module" src="[^"]*index\.js[^"]*"></script>',
        f'<script type="module" src="/dev/assets/index.js?v={ver}"></script>',
        html
    )
    # CSS
    html = re.sub(
        r'<link rel="stylesheet" href="[^"]*index\.css[^"]*" />',
        f'<link rel="stylesheet" href="/dev/assets/index.css?v={ver}" />',
        html
    )
    return html

def get_site_html(slug):
    """Fetch current site HTML via curl."""
    result = subprocess.run(
        ["curl", "-s", f"https://propbook.pro/props/{slug}/"],
        capture_output=True, text=True, timeout=15
    )
    return result.stdout

def main(slugs):
    proj = os.path.dirname(__file__)
    dist_js  = os.path.join(proj, "src/dist/assets/index.js")
    dist_css = os.path.join(proj, "src/dist/assets/index.css")

    ver = get_version()
    if not ver:
        print("ERROR: Could not read BUNDLE_VERSION from bundle-versions.ts")
        sys.exit(1)
    print(f"Using bundle version: {ver}")

    # Upload bundle files
    print("Uploading bundle to /dev/assets/ ...")
    js_ok  = upload_file(dist_js,  f"{DEV_DIR}/index.js")
    css_ok = upload_file(dist_css, f"{DEV_DIR}/index.css")
    print(f"  index.js -> {'OK' if js_ok  else 'FAIL'}")
    print(f"  index.css-> {'OK' if css_ok else 'FAIL'}")

    # Update each site's HTML
    for slug in slugs:
        print(f"\nUpdating site: {slug}")
        html = get_site_html(slug)
        if not html or "index.js" not in html:
            print(f"  [{slug}] Could not fetch HTML")
            continue

        original = html
        html = update_html(html, ver)
        if html == original:
            print(f"  [{slug}] Already up to date")
            continue

        result = upload_html(slug, html)
        if result.get("success"):
            print(f"  [{slug}] OK")
        else:
            print(f"  [{slug}] FAIL: {result.get('error', 'unknown')}")

    print("\nDone.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 upload-site.py <slug> [slug2 ...]")
        sys.exit(1)
    main(sys.argv[1:])
