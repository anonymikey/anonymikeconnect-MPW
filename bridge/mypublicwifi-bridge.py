import argparse, hashlib, hmac, json, logging, os, sqlite3, time
from datetime import datetime, timezone
from pathlib import Path
from urllib import request, error

APPROVED = {'RYRNN', 'KSSSS'}

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

def post_event(cfg, payload):
    body = json.dumps(payload).encode()
    signature = hmac.new(cfg['bridge_secret'].encode(), body, hashlib.sha256).hexdigest()
    req = request.Request(cfg['backend_url'].rstrip('/') + '/api/integrations/mypublicwifi/session', data=body, headers={
        'content-type': 'application/json', 'x-bridge-id': cfg['bridge_id'], 'x-bridge-signature': signature})
    with request.urlopen(req, timeout=10) as response: return response.status, response.read().decode()

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--config', default='config.json'); args = parser.parse_args()
    cfg = json.loads(Path(args.config).read_text(encoding='utf-8'))
    logging.basicConfig(filename=cfg.get('log_path', 'mypublicwifi-bridge.log'), level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    state_path = Path(cfg.get('state_path', 'bridge-state.json')); state = json.loads(state_path.read_text()) if state_path.exists() else {'delivered': {}}
    while True:
        try:
            for row in read_sessions(cfg['data_db_path']):
                voucher = str(row.get('voucher') or '').strip().upper()
                if voucher not in APPROVED: continue
                key = event_key(row['mac'], row['account_id'], row['start_time'])
                if key in state['delivered']: continue
                payload = {'event_type':'SESSION_STARTED','event_key':key,'voucher':voucher,'mac':str(row['mac']), 'account_id':int(row['account_id']), 'start_time':str(row['start_time']), 'bridge_id':cfg['bridge_id'],'occurred_at':iso_now()}
                try:
                    status, response = post_event(cfg, payload)
                    if status < 500:
                        state['delivered'][key] = {'at': iso_now(), 'response': response}; state_path.write_text(json.dumps(state, indent=2), encoding='utf-8')
                    logging.info('event=%s status=%s response=%s', key, status, response)
                except Exception as exc: logging.warning('event=%s network_error=%s', key, exc)
        except Exception as exc: logging.warning('poll_error=%s', exc)
        time.sleep(max(2, min(5, int(cfg.get('poll_seconds', 3)))))

if __name__ == '__main__': main()
