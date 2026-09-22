#!/usr/bin/env python3
"""
Propbook — deploy the main /app bundle (admin/dashboard/customer React app)
over plain FTP (this hosting plan has no SSH access).

Uses the FTP_* credentials already in src/.env (same account that
upload-site.py's FTP_UPLOAD_PATH points at, just a different subfolder:
.../public_html/app/ instead of .../public_html/dev/).

Steps: build -> backup live app/assets/ (rename in place) -> upload
index.js/index.css/index.html/index.php -> verify each uploaded file's
size on the server matches the local build exactly.

Run this after any src/ change that needs to reach the live /app.
"""
import subprocess, os, time
from ftplib import FTP

def _load_env(path):
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

FTP_HOST = _require('FTP_HOST')
FTP_PORT = int(os.environ.get('FTP_PORT', '21'))
FTP_USER = _require('FTP_USER')
FTP_PASS = _require('FTP_PASS')

# FTP_UPLOAD_PATH in .env points at .../public_html/dev/assets/ — same
# account, just swap the "dev" segment for "app" to land in the main app's
# folder instead of the shared property-site bundle's folder.
_dev_path = _require('FTP_UPLOAD_PATH').rstrip('/')
if '/dev/assets' not in _dev_path:
    raise RuntimeError(f"FTP_UPLOAD_PATH ({_dev_path}) doesn't look like .../dev/assets — "
                        f"update APP_ASSETS_DIR below by hand instead of guessing.")
APP_ASSETS_DIR = _dev_path.replace('/dev/assets', '/app/assets')
APP_ROOT_DIR = APP_ASSETS_DIR.rsplit('/assets', 1)[0]

proj = os.path.dirname(os.path.abspath(__file__))


def connect():
    ftp = FTP()
    ftp.connect(FTP_HOST, FTP_PORT, timeout=30)
    ftp.login(FTP_USER, FTP_PASS)
    return ftp


def ftp_upload(ftp, local_path, remote_path):
    remote_dir, remote_name = remote_path.rsplit('/', 1)
    ftp.cwd(remote_dir)
    with open(local_path, 'rb') as f:
        ftp.storbinary(f'STOR {remote_name}', f)


def ftp_size(ftp, remote_path):
    remote_dir, remote_name = remote_path.rsplit('/', 1)
    ftp.cwd(remote_dir)
    try:
        ftp.voidcmd('TYPE I')  # binary mode — SIZE is unreliable in ASCII mode
        return ftp.size(remote_name)
    except Exception as e:
        return None


print(f"[0] Connecting to FTP {FTP_HOST}:{FTP_PORT}...")
ftp = connect()
print("  Connected.")

print("\n[1] Backing up current live app/assets/ (rename in place)...")
ts = time.strftime("%Y%m%d%H%M%S")
try:
    ftp.cwd(APP_ROOT_DIR)
    ftp.rename('assets', f'assets_backup_{ts}')
    ftp.mkd('assets')
    print(f"  Backed up to assets_backup_{ts}, fresh assets/ dir created.")
except Exception as e:
    print(f"  Backup/rename skipped ({e}) — continuing, uploads will just overwrite in place.")
    try:
        ftp.mkd('assets')
    except Exception:
        pass

print("\n[2] Building React app (npm run build, base=/app/)...")
build_env = {**os.environ, "VITE_BASE_PATH": "/app/"}
result = subprocess.run("npm run build", shell=True, cwd=proj, env=build_env, capture_output=True, text=True, timeout=180)
if result.returncode != 0:
    print(f"  BUILD FAILED:\n{result.stderr[-1500:]}")
    exit(1)

js_path = f"{proj}/src/dist/assets/index.js"
css_path = f"{proj}/src/dist/assets/index.css"
html_path = f"{proj}/src/dist/index.html"
php_path = f"{proj}/src/dist/index.php"
if not (os.path.exists(js_path) and os.path.exists(css_path)):
    print(f"  Build succeeded but expected output not found at {js_path} / {css_path}")
    exit(1)
print(f"  Built OK — JS: {os.path.getsize(js_path)//1024}KB, CSS: {os.path.getsize(css_path)//1024}KB")

uploads = [
    (js_path, f"{APP_ASSETS_DIR}/index.js"),
    (css_path, f"{APP_ASSETS_DIR}/index.css"),
]
if os.path.exists(html_path):
    uploads.append((html_path, f"{APP_ROOT_DIR}/index.html"))
if os.path.exists(php_path):
    uploads.append((php_path, f"{APP_ROOT_DIR}/index.php"))

# /app/ never had a SPA-fallback .htaccess -- any route besides the bare
# root (/app/auth/confirm for password-reset/email-confirm links included)
# 404s straight from Apache before React Router ever sees it. Property-site
# folders now get this from siteDuplicationService.ts on every publish; /app/
# is a plain FTP deploy with no equivalent, so it has to be written here.
htaccess_path = f"{proj}/src/dist/.htaccess"
with open(htaccess_path, "w") as f:
    f.write(
        "RewriteEngine On\n"
        "RewriteBase /app/\n"
        "RewriteCond %{REQUEST_FILENAME} !-f\n"
        "RewriteCond %{REQUEST_FILENAME} !-d\n"
        "RewriteRule ^ index.html [L]\n"
    )
uploads.append((htaccess_path, f"{APP_ROOT_DIR}/.htaccess"))

print("\n[3] Uploading over FTP...")
all_ok = True
for local_path, remote_path in uploads:
    name = remote_path.rsplit('/', 1)[1]
    local_size = os.path.getsize(local_path)
    try:
        ftp_upload(ftp, local_path, remote_path)
        remote_size = ftp_size(ftp, remote_path)
        if remote_size == local_size:
            print(f"  {name:<12} -> OK  ({remote_size} bytes, matches local)")
        else:
            print(f"  {name:<12} -> MISMATCH  local={local_size} remote={remote_size} — re-run, don't trust this deploy")
            all_ok = False
    except Exception as e:
        print(f"  {name:<12} -> FAILED  {e}")
        all_ok = False

ftp.quit()

print()
if all_ok:
    print("Done, and every file's size was verified byte-for-byte on the server.")
    print("Remember: Cloudflare/browser caches don't know about this deploy on their own —")
    print("the JS/CSS URLs are cache-busted automatically (?v=... in index.html), but if you")
    print("still see stale behavior, purge Cloudflare for propbook.pro/app/* just in case.")
else:
    print("One or more uploads did NOT verify — do not assume this deploy is live. Re-run.")
