# MyPublicWiFi free-access bridge

1. Install Python 3.11+ for Windows and copy this folder to `C:\\SupaLanBridge`.
2. Copy `config.example.json` to `config.json`.
3. Generate a secret with PowerShell: `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))` (use a password manager if preferred). Put the same value in `config.json` as `bridge_secret` and Render as `MYPUBLICWIFI_BRIDGE_SECRET`.
4. Set `bridge_id` to a unique name. Confirm `data_db_path` points to `C:\\Program Files (x86)\\MyPublicWiFi\\Data.db`.
5. Test read-only access: `py -3 mypublicwifi-bridge.py --config config.json`; it should keep running and create only the local log/state files. Stop with Ctrl+C. It never writes `Data.db`.
6. Start it with `py -3 mypublicwifi-bridge.py --config config.json`. Check `mypublicwifi-bridge.log` for poll and event results.
7. Allow inbound TCP port 8765 from the SUPA LAN client network in Windows Firewall. The bridge exposes only `POST /challenge`; it stores the opaque token in memory for five minutes and never writes to MyPublicWiFi Data.db.
8. The authenticated success page posts the session MAC and opaque challenge token to `http://192.168.10.1:8765/challenge`. If your gateway uses another LAN address, update the URL in `success.html` and keep the listener reachable only from the private Wi-Fi network.
9. For automatic startup, create a Task Scheduler task named `SupaLanBridge`, trigger “At startup”, run `py -3 C:\\SupaLanBridge\\mypublicwifi-bridge.py --config C:\\SupaLanBridge\\config.json`, and set “Start in” to `C:\\SupaLanBridge`.
8. To stop/uninstall, end the Task Scheduler task and delete the task and folder. Do not delete MyPublicWiFi files.

Production prerequisites: apply migrations `004_free_access_sms.sql` and `005_free_access_challenges.sql`, set both `MYPUBLICWIFI_BRIDGE_SECRET` and `MYPUBLICWIFI_BRIDGE_ID`, set `SMS_AUTOMATION_ENABLED=true`, configure the admin active voucher and enable free access, then perform a real `SessionType=1` test. The post-auth challenge is short-lived and one-time; the bridge must independently observe the matching MAC/session before SMS delivery.
