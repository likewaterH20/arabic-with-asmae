#!/usr/bin/env python3
"""Tiny static server with HTTP Range support (so local <video> can seek). No deps."""
import os, sys, re, mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
mimetypes.add_type('video/mp4', '.mp4'); mimetypes.add_type('application/json', '.json')

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache'); self.send_header('Accept-Ranges', 'bytes'); super().end_headers()
    def do_GET(self):
        path = self.translate_path(self.path.split('?')[0])
        rng = self.headers.get('Range')
        if rng and os.path.isfile(path):
            m = re.match(r'bytes=(\d*)-(\d*)', rng)
            size = os.path.getsize(path)
            start = int(m.group(1)) if m.group(1) else max(0, size - int(m.group(2)))
            end = int(m.group(2)) if m.group(2) and m.group(1) else size - 1
            end = min(end, size - 1)
            if start > end: self.send_response(416); self.end_headers(); return
            self.send_response(206)
            self.send_header('Content-Type', mimetypes.guess_type(path)[0] or 'application/octet-stream')
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(end - start + 1))
            self.end_headers()
            with open(path, 'rb') as f:
                f.seek(start); left = end - start + 1
                while left > 0:
                    chunk = f.read(min(1 << 16, left))
                    if not chunk: break
                    try: self.wfile.write(chunk)
                    except BrokenPipeError: return
                    left -= len(chunk)
            return
        super().do_GET()

if __name__ == '__main__':
    print(f'Arabic with Asmae → http://localhost:{PORT}')
    ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
