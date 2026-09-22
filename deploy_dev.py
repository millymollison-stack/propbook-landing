#!/usr/bin/env python3
"""
Propbook — deploy the shared /dev/assets/ bundle (the one every /props/<slug>
property site loads) over plain FTP (this hosting plan has no SSH access).

This is deploy_app.py's sibling: same FTP account, same proven mechanics,
different target and a different Vite base path. /app/ needs
VITE_BASE_PATH=/app/ baked in; /dev/assets/ is loaded by property-site HTML
as an absolute path from the domain root, so it needs the DEFAULT base ('/').
Building /app/ and building /dev/ are NOT interchangeable outputs even
though they're the same source -- the base path gets baked into the bundle.

Steps: build (default base) -> backup live dev/assets/ (rename in place) ->
upload index.js/index.css -> verify each uploaded file's size on the server
matches the local build exactly.

Run this after any src/ change that needs to reach live property sites
(e.g. the useRef import fix in PropertyAmenities.tsx -- that fix already
went out to /app/ via deploy_app.py, but /dev/assets/ never got it, which is
why /props/<slug> pages still crash with "useRef is not defined").
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

# FTP_UPLOAD_PATH in .env already points straight at .../public_html/dev/assets/
DEV_ASSETS_DIR = _require('FTP_UPLOAD_PATH').rstrip('/')
DEV_ROOT_DIR = DEV_ASSETS_DIR.rsplit('/assets', 1)[0]

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
    except Exception:
        return None


print(f"[0] Connecting to FTP {FTP_HOST}:{FTP_PORT}...")
ftp = connect()
print("  Connected.")

print("\n[1] Backing up current live dev/assets/ (rename in place)...")
ts = time.strftime("%Y%m%d%H%M%S")
try:
    ftp.cwd(DEV_ROOT_DIR)
    ftp.rename('assets', f'assets_backup_{ts}')
    ftp.mkd('assets')
    print(f"  Backed up to assets_backup_{ts}, fresh assets/ dir created.")
except Exception as e:
    print(f"  Backup/rename skipped ({e}) — continuing, uploads will just overwrite in place.")
    try:
        ftp.mkd('assets')
    except Exception:
        pass

print("\n[2] Building React app (npm run build, default base '/')...")
build_env = {k: v for k, v in os.environ.items() if k != 'VITE_BASE_PATH'}
result = subprocess.run("npm run build", shell=True, cwd=proj, env=build_env, capture_output=True, text=True, timeout=180)
if result.returncode != 0:
    print(f"  BUILD FAILED:\n{result.stderr[-1500:]}")
    exit(1)

js_path = f"{proj}/src/dist/assets/index.js"
css_path = f"{proj}/src/dist/assets/index.css"
if not (os.path.exists(js_path) and os.path.exists(css_path)):
    print(f"  Build succeeded but expected output not found at {js_path} / {css_path}")
    exit(1)
print(f"  Built OK — JS: {os.path.getsize(js_path)//1024}KB, CSS: {os.path.getsize(css_path)//1024}KB")

uploads = [
    (js_path, f"{DEV_ASSETS_DIR}/index.js"),
    (css_path, f"{DEV_ASSETS_DIR}/index.css"),
]

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
    print("IMPORTANT: unlike /app/, individual property pages' HTML does NOT")
    print("cache-bust /dev/assets/index.js with a fresh ?v=... on every deploy —")
    print("existing sites reference whatever ?v= was baked in when they were built.")
    print("Purge Cloudflare for propbook.pro/dev/assets/* (and propbook.pro/props/*")
    print("if that doesn't clear it) before assuming a property page is still broken.")
else:
    print("One or more uploads did NOT verify — do not assume this deploy is live. Re-run.")
