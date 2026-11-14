# Family Task Planner

A simple, touch-friendly household task board for a shared wall-mounted screen. It runs locally on Windows while you test it, and can later run on a Raspberry Pi 3B+ with Chromium in kiosk mode.

## Architecture

- **Application:** Python 3.10+ and Flask. One small Flask process serves the UI and a JSON API; there is no separate frontend build step or cloud dependency.
- **Interface:** responsive HTML, CSS, and vanilla JavaScript, designed for a touch screen. Tasks can be created, edited, assigned, tagged, completed, filtered by status, due date, assignee, and tag, paginated 10 at a time, and deleted. Household members can be added, renamed, given a face icon, and removed when they have no assigned tasks. Tags can be added, renamed, and removed when no tasks use them.
- **Persistence:** SQLite database stored on the host—not browser local storage. The default database is `instance/task_planner.sqlite3`; Windows and Raspberry Pi each keep their own file unless you deliberately move or back it up. Task due times are saved as local wall-clock time, so the Pi should use the household's timezone.
- **Reminders and retention:** the open task board highlights each incomplete task due within one hour and refreshes every minute. These are in-app alerts, not push notifications; the app must be open to see them. Completed tasks are permanently deleted seven days after being marked complete. Cleanup runs when the app starts and whenever the task list is requested. Reopening a task clears its completion date; completing it again starts a fresh seven-day period.
- **Network model:** the service listens on localhost by default. On the Pi it can listen on the home network so the kiosk browser and family phones can reach it. There are no accounts; use only on a trusted home network and do not forward its port to the internet.

## Run locally on Windows

Install Python 3.10 or newer, open PowerShell in this folder, and run:

```powershell
.\run.ps1
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000). The script creates a local `.venv`, installs Flask, and starts the app. Tasks are saved in `instance\task_planner.sqlite3`. Stop the server with Ctrl+C. The Windows database is separate from the Pi database; use a SQLite-aware backup or copy the database while the app is stopped if you need to move the household data.

To run the tests:

```powershell
.\.venv\Scripts\python.exe -m unittest discover -s tests -v
```

## Raspberry Pi deployment

### Prepare the Pi

Use Raspberry Pi OS with a desktop session and Chromium. Connect the touchscreen, enable automatic desktop login, set the Pi's timezone to the household timezone (for example with `sudo raspi-config`), and give it a stable address or DHCP reservation if you want to open the planner from phones.

Copy this folder to the Pi, for example to `/home/pi/TaskPlannerPi`. The first-time package installation below needs internet access unless Python and Flask are already installed or you have made the packages available locally. Once installed, the app itself works offline.

### Install and test the app

From the project directory on the Pi:

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
TASK_PLANNER_HOST=0.0.0.0 .venv/bin/python app.py
```

On the Pi, open `http://127.0.0.1:5000` to check the app. From another device on the home network, open `http://<pi-address>:5000`. Stop the foreground server with Ctrl+C before setting up the service below.

### Start the app at boot

Create `/etc/systemd/system/family-planner.service`, replacing `/home/pi/TaskPlannerPi` and `pi` if the project directory or Pi username differs:

```bash
sudo nano /etc/systemd/system/family-planner.service
```

Paste this service configuration:

```ini
[Unit]
Description=Family Task Planner
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/TaskPlannerPi
Environment=TASK_PLANNER_HOST=0.0.0.0
Environment=TASK_PLANNER_PORT=5000
ExecStart=/home/pi/TaskPlannerPi/.venv/bin/python /home/pi/TaskPlannerPi/app.py
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable the service and verify it is running:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now family-planner
sudo systemctl status family-planner
```

Confirm the service reports `active (running)` and the app opens at `http://127.0.0.1:5000`.

### Launch Chromium in kiosk mode

The app's systemd service starts Flask. Chromium should start separately from the logged-in desktop user's autostart configuration. In a terminal on the Pi desktop, check which desktop session is active:

```bash
echo $XDG_CURRENT_DESKTOP
```

If the session reports `labwc` (common on newer Raspberry Pi OS Desktop releases), create or edit the labwc autostart file:

```bash
mkdir -p ~/.config/labwc
nano ~/.config/labwc/autostart
```

Add this command, then save with Ctrl+O, Enter and exit with Ctrl+X:

```bash
#!/bin/sh
sleep 10
chromium --kiosk --noerrdialogs --disable-infobars --no-first-run http://127.0.0.1:5000 &
```

The delay gives the planner service time to start before Chromium opens.

For an older LXDE desktop session, create or edit its autostart file instead:

```bash
mkdir -p ~/.config/lxsession/LXDE-pi
nano ~/.config/lxsession/LXDE-pi/autostart
```

Add this line:

```text
@chromium --kiosk --noerrdialogs --disable-infobars --no-first-run http://127.0.0.1:5000
```

Some Raspberry Pi OS images name the browser command `chromium-browser`; use that instead if `chromium` is not found. Reboot the Pi and confirm the planner starts on the touchscreen. The app database is in `instance/task_planner.sqlite3`; it persists across reboots. Back it up somewhere other than the Pi's SD card before replacing the project or SD card. Completed-task cleanup is automatic, so export or back up anything you want to keep before its seven-day retention window ends. Keep the app on a trusted home network: it intentionally has no login or authorization, and its port should not be exposed to the internet.
