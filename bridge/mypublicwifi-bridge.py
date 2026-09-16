import argparse, hashlib, hmac, json, logging, sqlite3, threading, time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request
from urllib.error import HTTPError

APPROVED = {'RYRNN', 'KSSSS'}
PENDING = {}
PENDING_LOCK = threading.Lock()

def iso_now(): return datetime.now(timezone.utc).isoformat()
def event_key(mac, account_id, start_time):
    clean_mac = ''.join(c for c in str(mac).upper() if c.isalnum())
    return f'FREE_ACCESS:{clean_mac}:{int(account_id)}:{str(start_time).strip()}'

def read_sessions(db_path):
    uri = Path(db_path).resolve().as_uri() + '?mode=ro&immutable=1'
    con = sqlite3.connect(uri, uri=True, timeout=1)
    try:
        con.row_factory = sqlite3.Row
        rows = con.execute('''select s.MAC mac, s.AccountID account_id, s.StartTime start_time,
            s.SessionType session_type, c.Code voucher from Sessions s
            join CodeAccounts c on c.ID = s.AccountID where s.SessionType = 1''').fetchall()
        return [dict(row) for row in rows]
    finally: con.close()

class ChallengeHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header('access-control-allow-origin', '*')
        self.send_header('access-control-allow-methods', 'POST, OPTIONS')
        self.send_header('access-control-allow-headers', 'content-type')
    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()
    def do_POST(self):
        if self.path != '/challenge': self.send_error(404); return
        try:
            length = int(self.headers.get('content-length', '0'))
            body = json.loads(self.rfile.read(length))
            mac = ''.join(c for c in str(body.get('sessionMac', '')).upper() if c.isalnum())
            token = str(body.get('challengeToken', ''))
            if len(mac) != 12 or not token or len(token) > 512: raise ValueError('invalid challenge')
            with PENDING_LOCK: PENDING[mac] = {'token': token, 'expires': time.time() + 300}
            payload = b'{"accepted":true}'
            self.send_response(201); self._cors(); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(payload))); self.end_headers(); self.wfile.write(payload)
        except Exception:
            self.send_error(400)
    def log_message(self, *_): pass

def start_local_listener(cfg):
    server = ThreadingHTTPServer((cfg.get('local_bind', '0.0.0.0'), int(cfg.get('local_port', 8765))), ChallengeHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server

def post_event(cfg, payload):
    body = json.dumps(payload, separators=(',', ':')).encode()
    signature = hmac.new(cfg['bridge_secret'].encode(), body, hashlib.sha256).hexdigest()
    req = request.Request(cfg['backend_url'].rstrip('/') + '/api/integrations/mypublicwifi/session', data=body, headers={'content-type': 'application/json', 'x-bridge-id': cfg['bridge_id'], 'x-bridge-signature': signature})
    try:
        with request.urlopen(req, timeout=10) as response: return response.status, response.read().decode()
    except HTTPError as exc:
        return exc.code, exc.read().decode(errors='replace')

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', default='config.json'); args = parser.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding='utf-8'))
    if not cfg.get('bridge_id') or not cfg.get('bridge_secret'): raise SystemExit('bridge_id and bridge_secret are required')
    logging.basicConfig(filename=cfg.get('log_path', 'mypublicwifi-bridge.log'), level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    start_local_listener(cfg)
    state_path = Path(cfg.get('state_path', 'bridge-state.json')); state = json.loads(state_path.read_text()) if state_path.exists() else {'accepted': {}}
    while True:
        try:
            now = time.time()
            with PENDING_LOCK:
                for mac in list(PENDING):
                    if PENDING[mac]['expires'] < now: del PENDING[mac]
            for row in read_sessions(cfg['data_db_path']):
                voucher = str(row.get('voucher') or '').strip().upper()
                mac = ''.join(c for c in str(row.get('mac') or '').upper() if c.isalnum())
                if voucher not in APPROVED or len(mac) != 12: continue
                with PENDING_LOCK: pending = PENDING.get(mac)
                if not pending: continue
                key = event_key(row['mac'], row['account_id'], row['start_time'])
                if key in state['accepted']: continue
                payload = {'event_type':'SESSION_STARTED','event_key':key,'challenge_token':pending['token'],'voucher':voucher,'mac':str(row['mac']),'account_id':int(row['account_id']),'start_time':str(row['start_time']),'occurred_at':iso_now()}
                try:
                    status, response = post_event(cfg, payload)
                    logging.info('event=%s status=%s response=%s', key, status, response)
                    if 200 <= status < 300:
                        state['accepted'][key] = {'at': iso_now(), 'response': response}; state_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
                        with PENDING_LOCK: PENDING.pop(mac, None)
                    elif 400 <= status < 500:
                        with PENDING_LOCK: PENDING.pop(mac, None)
                except Exception as exc: logging.warning('event=%s retryable_error=%s', key, exc)
        except Exception as exc: logging.warning('poll_error=%s', exc)
        time.sleep(max(2, min(5, int(cfg.get('poll_seconds', 3)))))

if __name__ == '__main__': main()
