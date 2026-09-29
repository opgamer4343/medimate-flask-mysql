# MediMate – Flask + MySQL Medication Reminder App

MediMate is a database-backed medicine reminder and medication tracking application built around the supplied Stitch frontend. The visual design is retained while the application state is powered by Flask and MySQL.

## Features

### Authentication and security
- Public landing page first
- Register, login, logout
- Werkzeug password hashing
- Flask session authentication
- CSRF protection for state-changing requests
- Secure session cookie settings
- Server-side ownership checks on medicines, logs, APIs and settings

### Medication management
- Add, edit and delete medicines
- Once Daily, Twice Daily, Three Times Daily and As Needed schedules
- Multiple reminder times per medicine
- Medicine details modal with schedule, date range and adherence
- Search medicines
- Active / Completed(ended) / Expired / As Needed filters
- Medicine end-date warnings

### Reminders
- Automatic due-dose polling while the app is open
- In-app reminder popup
- Browser notification support
- Optional audible reminder chime
- Take, Skip and Remind Later actions
- Remind Later options: 5, 15 or 30 minutes
- 30-minute missed-dose grace period
- Automatic Pending -> Missed detection
- Upcoming medicine display

### Tracking and analytics
- Today's medication schedule
- Taken / Pending / Skipped / Missed counts
- Medication adherence percentage
- Weekly Monday-Sunday report
- Medication streak
- Calendar history by date
- History search and filters
- Persistent notification history
- CSV medication-history export

### Settings
- Profile update
- Change password
- Persistent notification preferences

## Technology
- Python 3
- Flask
- MySQL
- mysql-connector-python
- Werkzeug
- python-dotenv
- HTML/CSS/Vanilla JavaScript
- Existing frontend libraries from the supplied prototype

## Setup on Windows

### 1. Create the database

Open MySQL Workbench and run:

```sql
CREATE DATABASE medimate_db;
```

Then open `database/medimate.sql` in Workbench and execute it.

The schema contains:
- users
- medicines
- medicine_schedules
- medication_logs
- user_settings
- notifications

If you already have an older MediMate database, the Flask application also creates the new feature tables and the `snoozed_until` column when it starts.

### 2. Create `.env`

Copy `.env.example` to `.env`:

```env
SECRET_KEY=change-this-secret-key
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=medimate_db
```

Never commit `.env` or real credentials.

### 3. Create a virtual environment

```powershell
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 4. Optional demo data

```powershell
python database\seed_demo.py
```

Demo account:

```text
Email: demo@medimate.com
Password: Demo@123
```

The demo data is fictional.

### 5. Start the application

```powershell
python app.py
```

Open:

```text
http://127.0.0.1:5000
```

## Reminder behavior

MediMate checks pending scheduled doses every 15 seconds while the authenticated dashboard is open. When a dose is due, it can show the in-app popup, a browser notification and an optional sound based on the user's settings.

Browser notification permission must be granted by the user. A normal local Flask application cannot guarantee system notifications when the browser is completely closed without a Web Push service.

## Testing checklist

- Landing page -> login/register
- Register and login
- Logout and protected-route redirects
- Add once/twice/three-times daily medicine
- Add As Needed medicine
- Edit and delete medicine
- View medicine details and adherence
- Search/filter medicines
- Automatic due reminder
- Browser notification permission
- Reminder sound
- Take / Skip / Remind Later
- Missed-dose conversion
- Dashboard counts and adherence
- Upcoming dose countdown
- Streak
- Calendar history
- History filters
- Weekly reports
- Notification history
- Profile update
- Password change
- CSV export
- Verify two users cannot access each other's records

## Important medical disclaimer

MediMate is a medication reminder and tracking tool. It does not diagnose conditions, prescribe medicines, change prescriptions, or replace advice from a licensed healthcare professional.
