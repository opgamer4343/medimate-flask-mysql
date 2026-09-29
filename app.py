import csv
import io
import os
import secrets
from datetime import date, datetime, time, timedelta
from functools import wraps

import mysql.connector
from flask import Flask, jsonify, redirect, render_template, request, session, url_for, make_response
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash

from config import Config

load_dotenv()

app = Flask(__name__)
app.config.from_object(Config)
app.config.setdefault("MAX_CONTENT_LENGTH", 2 * 1024 * 1024)


def ensure_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


@app.context_processor
def inject_security_context():
    return {"csrf_token": ensure_csrf_token()}


@app.before_request
def security_guard():
    ensure_csrf_token()
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        supplied = request.headers.get("X-CSRFToken") or request.form.get("csrf_token")
        if not supplied or not secrets.compare_digest(supplied, session.get("csrf_token", "")):
            return json_error("Security token missing or invalid. Refresh the page and try again.", 400)


@app.after_request
def add_security_headers(response):
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


def get_db():
    """Create a fresh MySQL connection for one request/transaction."""
    return mysql.connector.connect(
        host=app.config["DB_HOST"],
        user=app.config["DB_USER"],
        password=app.config["DB_PASSWORD"],
        database=app.config["DB_NAME"],
        autocommit=False,
    )


def close_db(conn, cursor=None):
    try:
        if cursor is not None:
            cursor.close()
    finally:
        if conn is not None and conn.is_connected():
            conn.close()


def json_error(message, status=400):
    return jsonify({"success": False, "message": message}), status


def login_required(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/") or request.is_json:
                return json_error("Authentication required.", 401)
            return redirect(url_for("login"))
        return fn(*args, **kwargs)
    return wrapped


def parse_date(value, required=False):
    if not value:
        if required:
            raise ValueError("Date is required.")
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Invalid date. Use YYYY-MM-DD.")


def parse_time(value):
    if not value:
        raise ValueError("Scheduled time is required.")
    value = value.strip()
    for fmt in ("%H:%M", "%I:%M %p", "%I:%M%p"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            continue
    raise ValueError("Invalid time. Use HH:MM or h:mm AM/PM.")


def format_time(t):
    if not t:
        return ""
    if isinstance(t, timedelta):
        total_seconds = int(t.total_seconds())
        h, rem = divmod(total_seconds, 3600)
        m = rem // 60
        return f"{h:02d}:{m:02d}"
    if isinstance(t, time):
        return t.strftime("%H:%M")
    return str(t)[:5]


def format_time_display(t):
    if not t:
        return ""
    if isinstance(t, timedelta):
        total_seconds = int(t.total_seconds())
        h, rem = divmod(total_seconds, 3600)
        m = rem // 60
        return datetime(2000, 1, 1, h % 24, m).strftime("%I:%M %p")
    if isinstance(t, time):
        return t.strftime("%I:%M %p")
    try:
        return datetime.strptime(str(t)[:5], "%H:%M").strftime("%I:%M %p")
    except ValueError:
        return str(t)


def medicine_active_clause(alias="m"):
    return f"{alias}.start_date <= %s AND ({alias}.end_date IS NULL OR {alias}.end_date >= %s)"


def ensure_today_logs(conn, user_id, target_date=None):
    """Create active schedule logs and update overdue Pending doses with a 30-minute grace period."""
    target_date = target_date or date.today()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            """
            SELECT m.id AS medicine_id, ms.id AS schedule_id, ms.scheduled_time
            FROM medicines m
            JOIN medicine_schedules ms ON ms.medicine_id = m.id
            WHERE m.user_id = %s
              AND m.start_date <= %s
              AND (m.end_date IS NULL OR m.end_date >= %s)
            """,
            (user_id, target_date, target_date),
        )
        for row in cur.fetchall():
            cur.execute(
                """
                INSERT IGNORE INTO medication_logs
                    (user_id, medicine_id, schedule_id, scheduled_date, scheduled_time, status)
                VALUES (%s, %s, %s, %s, %s, 'Pending')
                """,
                (user_id, row["medicine_id"], row["schedule_id"], target_date, row["scheduled_time"]),
            )

        if target_date < date.today():
            cur.execute(
                "UPDATE medication_logs SET status='Missed' WHERE user_id=%s AND scheduled_date=%s AND status='Pending'",
                (user_id, target_date),
            )
        elif target_date == date.today():
            cutoff = (datetime.now() - timedelta(minutes=30)).time()
            cur.execute(
                """
                UPDATE medication_logs
                SET status = 'Missed'
                WHERE user_id = %s
                  AND scheduled_date = %s
                  AND status = 'Pending'
                  AND scheduled_time < %s
                  AND (snoozed_until IS NULL OR snoozed_until < NOW())
                """,
                (user_id, target_date, cutoff),
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()


def fetch_medicines(conn, user_id):
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            """
            SELECT m.id, m.medicine_name, m.dosage, m.frequency,
                   m.start_date, m.end_date, m.instructions
            FROM medicines m
            WHERE m.user_id = %s
            ORDER BY m.created_at DESC, m.id DESC
            """,
            (user_id,),
        )
        medicines = cur.fetchall()
        for med in medicines:
            cur.execute(
                """
                SELECT id, scheduled_time
                FROM medicine_schedules
                WHERE medicine_id = %s
                ORDER BY scheduled_time
                """,
                (med["id"],),
            )
            schedules = cur.fetchall()
            med["schedules"] = schedules
        return medicines
    finally:
        cur.close()


def fetch_today_schedule(conn, user_id):
    ensure_today_logs(conn, user_id)
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            """
            SELECT
                m.id AS medicine_id,
                ms.id AS schedule_id,
                m.medicine_name,
                m.dosage,
                m.frequency,
                m.instructions,
                ms.scheduled_time,
                l.status,
                l.taken_time
            FROM medicines m
            JOIN medicine_schedules ms ON ms.medicine_id = m.id
            LEFT JOIN medication_logs l
              ON l.medicine_id = m.id
             AND l.schedule_id = ms.id
             AND l.scheduled_date = %s
            WHERE m.user_id = %s
              AND m.start_date <= %s
              AND (m.end_date IS NULL OR m.end_date >= %s)
            ORDER BY ms.scheduled_time, m.medicine_name
            """,
            (date.today(), user_id, date.today(), date.today()),
        )
        return cur.fetchall()
    finally:
        cur.close()


def serialize_medicine(row):
    schedules = row.get("schedules", [])
    return {
        "id": row["id"],
        "name": row["medicine_name"],
        "dosage": row["dosage"],
        "frequency": row["frequency"],
        "instructions": row.get("instructions") or "",
        "startDate": row["start_date"].isoformat() if row.get("start_date") else "",
        "endDate": row["end_date"].isoformat() if row.get("end_date") else "",
        "times": [format_time_display(s["scheduled_time"]) for s in schedules],
        "time": format_time_display(schedules[0]["scheduled_time"]) if schedules else "",
        "status": "Active",
    }


def get_user(conn, user_id):
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id, name, email FROM users WHERE id = %s", (user_id,))
        return cur.fetchone()
    finally:
        cur.close()


def build_state():
    user_id = session["user_id"]
    conn = get_db()
    try:
        user = get_user(conn, user_id)
        medicines = fetch_medicines(conn, user_id)
        today = fetch_today_schedule(conn, user_id)
        meds_json = [serialize_medicine(m) for m in medicines]

        # Medicine status describes its lifecycle, not today's dose status.
        # This keeps the catalog Active/Completed/As Needed filters stable.
        for m in meds_json:
            start = datetime.strptime(m["startDate"], "%Y-%m-%d").date() if m["startDate"] else None
            end = datetime.strptime(m["endDate"], "%Y-%m-%d").date() if m["endDate"] else None
            if end and end < date.today():
                m["status"] = "Expired"
            elif start and start > date.today():
                m["status"] = "Upcoming"
            else:
                m["status"] = "Active"

        cur = conn.cursor(dictionary=True)
        cur.execute(
            """
            SELECT id, medicine_id, schedule_id, scheduled_date, scheduled_time,
                   status, taken_time
            FROM medication_logs
            WHERE user_id = %s
            ORDER BY scheduled_date DESC, scheduled_time DESC, id DESC
            LIMIT 500
            """,
            (user_id,),
        )
        logs = cur.fetchall()
        cur.close()

        med_map = {m["id"]: m for m in medicines}
        history = []
        for log in logs:
            med = med_map.get(log["medicine_id"])
            if not med:
                continue
            history.append({
                "id": log["id"],
                "date": log["scheduled_date"].strftime("%d %b %Y"),
                "dateIso": log["scheduled_date"].isoformat(),
                "medicine": med["medicine_name"],
                "dosage": med["dosage"],
                "scheduledTime": format_time_display(log["scheduled_time"]),
                "status": log["status"],
                "takenAt": log["taken_time"].strftime("%I:%M %p") if log["taken_time"] else "—",
                "notes": med.get("instructions") or "",
            })

        notifications = []
        for item in today:
            if item["status"] in ("Pending",):
                notifications.append({
                    "id": f"{item['medicine_id']}-{item['schedule_id']}",
                    "text": f"💊 {item['medicine_name']} reminder scheduled for {format_time_display(item['scheduled_time'])}",
                    "time": "Today",
                    "read": False,
                })

        return {
            "user": {
                "name": user["name"],
                "email": user["email"],
                "role": "MediMate User",
            },
            "medicines": meds_json,
            "todaySchedules": [
                {
                    "medicineId": x["medicine_id"],
                    "scheduleId": x["schedule_id"],
                    "name": x["medicine_name"],
                    "dosage": x["dosage"],
                    "instructions": x.get("instructions") or "",
                    "time": format_time_display(x["scheduled_time"]),
                    "status": x["status"],
                    "takenAt": x["taken_time"].strftime("%I:%M %p") if x["taken_time"] else "—",
                }
                for x in today
            ],
            "history": history,
            "settings": get_user_settings(conn, user_id),
            "notifications": notifications,
            "auth": {"isLoggedIn": True},
        }
    finally:
        close_db(conn)


@app.route("/")
def home():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return render_template("landing.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("dashboard"))
        return render_template("dashboard.html", initial_view="dashboard", auth_mode="login")
    data = request.get_json(silent=True) or request.form
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return json_error("Email and password are required.")
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id, name, email, password FROM users WHERE email = %s", (email,))
        user = cur.fetchone()
        if not user or not check_password_hash(user["password"], password):
            return json_error("Invalid email or password.", 401)
        csrf = session.get("csrf_token")
        session.clear()
        session["csrf_token"] = csrf or secrets.token_urlsafe(32)
        session["user_id"] = user["id"]
        session["user_name"] = user["name"]
        session.permanent = True
        return jsonify({"success": True, "message": "Signed in successfully."})
    finally:
        close_db(conn, cur)


@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "GET":
        if "user_id" in session:
            return redirect(url_for("dashboard"))
        return render_template("dashboard.html", initial_view="dashboard", auth_mode="register")
    data = request.get_json(silent=True) or request.form
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    confirm = data.get("confirm_password") or data.get("password_confirm") or ""
    if not name or not email or not password:
        return json_error("Name, email and password are required.")
    if confirm != password:
        return json_error("Passwords do not match.")
    if len(password) < 8:
        return json_error("Password must be at least 8 characters.")
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email = %s", (email,))
        if cur.fetchone():
            return json_error("An account with that email already exists.", 409)
        cur.execute(
            "INSERT INTO users (name, email, password) VALUES (%s, %s, %s)",
            (name, email, generate_password_hash(password)),
        )
        user_id = cur.lastrowid
        conn.commit()
        csrf = session.get("csrf_token")
        session.clear()
        session["csrf_token"] = csrf or secrets.token_urlsafe(32)
        session["user_id"] = user_id
        session["user_name"] = name
        session.permanent = True
        return jsonify({"success": True, "message": "Account created successfully."})
    except Exception:
        conn.rollback()
        raise
    finally:
        close_db(conn, cur)


@app.route("/logout")
@login_required
def logout():
    session.clear()
    if request.headers.get("Accept", "").startswith("application/json"):
        return jsonify({"success": True})
    return redirect(url_for("login"))


@app.route("/api/state")
@login_required
def api_state():
    try:
        return jsonify(build_state())
    except mysql.connector.Error:
        return json_error("Database error while loading MediMate data.", 500)


@app.route("/dashboard")
@login_required
def dashboard():
    return render_template("dashboard.html", initial_view="dashboard")


@app.route("/medicines")
@login_required
def medicines():
    return render_template("dashboard.html", initial_view="medicines")


@app.route("/add-medicine", methods=["GET", "POST"])
@login_required
def add_medicine():
    if request.method == "GET":
        return render_template("dashboard.html", initial_view="add-edit-medicine")
    return save_medicine()


@app.route("/edit-medicine/<int:medicine_id>", methods=["GET", "POST"])
@login_required
def edit_medicine(medicine_id):
    if request.method == "GET":
        return render_template("dashboard.html", initial_view="add-edit-medicine")
    return save_medicine(medicine_id)


def get_payload():
    if request.is_json:
        data = request.get_json() or {}
        return data
    return request.form.to_dict(flat=False)


def payload_value(data, key, default=""):
    value = data.get(key, default)
    if isinstance(value, list):
        return value[0] if value else default
    return value


def payload_list(data, key):
    value = data.get(key, [])
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    return [str(value).strip()] if value else []


def save_medicine(medicine_id=None):
    data = get_payload()
    name = payload_value(data, "medicine_name", payload_value(data, "name")).strip()
    dosage = payload_value(data, "dosage").strip()
    frequency = payload_value(data, "frequency", "Once Daily").strip()
    instructions = payload_value(data, "instructions").strip()
    start_date = payload_value(data, "start_date")
    end_date = payload_value(data, "end_date")
    times = payload_list(data, "scheduled_times")
    if not times:
        times = payload_list(data, "times")
    if not times and frequency != "As Needed":
        times = [payload_value(data, "reminder_time", "09:00")]

    if not name or not dosage or not start_date:
        return json_error("Medicine name, dosage and start date are required.")
    try:
        start = parse_date(start_date, required=True)
        end = parse_date(end_date) if end_date else None
        if end and start > end:
            return json_error("End date cannot be before start date.")
        parsed_times = [parse_time(t) for t in times]
    except ValueError as exc:
        return json_error(str(exc))

    user_id = session["user_id"]
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        if medicine_id is not None:
            cur.execute(
                "SELECT id FROM medicines WHERE id = %s AND user_id = %s",
                (medicine_id, user_id),
            )
            if not cur.fetchone():
                return json_error("Medicine not found.", 404)
            cur.execute(
                """
                UPDATE medicines
                SET medicine_name=%s, dosage=%s, frequency=%s,
                    start_date=%s, end_date=%s, instructions=%s
                WHERE id=%s AND user_id=%s
                """,
                (name, dosage, frequency, start, end, instructions, medicine_id, user_id),
            )
            # Existing logs retain historical schedule_id where possible; new schedule IDs are safe.
            cur.execute("DELETE FROM medicine_schedules WHERE medicine_id = %s", (medicine_id,))
            med_id = medicine_id
            message = "Medicine updated successfully."
        else:
            cur.execute(
                """
                INSERT INTO medicines
                    (user_id, medicine_name, dosage, frequency, start_date, end_date, instructions)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (user_id, name, dosage, frequency, start, end, instructions),
            )
            med_id = cur.lastrowid
            message = "Medicine added successfully."

        for scheduled_time in parsed_times:
            cur.execute(
                "INSERT INTO medicine_schedules (medicine_id, scheduled_time) VALUES (%s, %s)",
                (med_id, scheduled_time),
            )
        conn.commit()
        return jsonify({"success": True, "message": message, "medicine_id": med_id})
    except Exception:
        conn.rollback()
        return json_error("Unable to save medicine.", 500)
    finally:
        close_db(conn, cur)


@app.route("/delete-medicine/<int:medicine_id>", methods=["POST"])
@login_required
def delete_medicine(medicine_id):
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM medicines WHERE id = %s AND user_id = %s", (medicine_id, session["user_id"]))
        if cur.rowcount == 0:
            conn.rollback()
            return json_error("Medicine not found.", 404)
        conn.commit()
        return jsonify({"success": True, "message": "Medicine deleted successfully."})
    except Exception:
        conn.rollback()
        return json_error("Unable to delete medicine.", 500)
    finally:
        close_db(conn, cur)


def medication_action(action, forced_medicine_id=None):
    data = request.get_json(silent=True) or request.form
    medicine_id = forced_medicine_id or data.get("medicine_id")
    schedule_id = data.get("schedule_id")
    scheduled_time_value = data.get("scheduled_time")
    if not medicine_id:
        return json_error("medicine_id is required.")

    try:
        medicine_id = int(medicine_id)
    except (TypeError, ValueError):
        return json_error("Invalid medicine ID.")

    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        # Ownership and active-period check happen before any medication mutation.
        cur.execute(
            """
            SELECT id, frequency, start_date, end_date
            FROM medicines
            WHERE id=%s AND user_id=%s
            """,
            (medicine_id, session["user_id"]),
        )
        medicine = cur.fetchone()
        if not medicine:
            return json_error("Medicine not found.", 404)
        today = date.today()
        if medicine["start_date"] > today or (medicine["end_date"] and medicine["end_date"] < today):
            return json_error("This medicine is not active today.", 400)

        # PRN / As Needed medicines intentionally have no fixed schedule.
        if medicine["frequency"] == "As Needed" and not schedule_id and not scheduled_time_value:
            now = datetime.now()
            status = "Taken" if action == "take" else "Skipped"
            cur.execute(
                """
                INSERT INTO medication_logs
                    (user_id, medicine_id, schedule_id, scheduled_date,
                     scheduled_time, status, taken_time)
                VALUES (%s, %s, NULL, %s, %s, %s, %s)
                """,
                (
                    session["user_id"],
                    medicine_id,
                    today,
                    now.time(),
                    status,
                    now if action == "take" else None,
                ),
            )
            conn.commit()
            return jsonify({"success": True, "status": status, "as_needed": True})

        if schedule_id:
            cur.execute(
                """
                SELECT ms.id, ms.scheduled_time
                FROM medicine_schedules ms
                JOIN medicines m ON m.id = ms.medicine_id
                WHERE ms.id=%s AND ms.medicine_id=%s AND m.user_id=%s
                """,
                (int(schedule_id), medicine_id, session["user_id"]),
            )
        elif scheduled_time_value:
            parsed = parse_time(str(scheduled_time_value))
            cur.execute(
                """
                SELECT ms.id, ms.scheduled_time
                FROM medicine_schedules ms
                JOIN medicines m ON m.id=ms.medicine_id
                WHERE ms.medicine_id=%s AND m.user_id=%s AND ms.scheduled_time=%s
                ORDER BY ms.id LIMIT 1
                """,
                (medicine_id, session["user_id"], parsed),
            )
        else:
            cur.execute(
                """
                SELECT ms.id, ms.scheduled_time
                FROM medicine_schedules ms
                JOIN medicines m ON m.id=ms.medicine_id
                WHERE ms.medicine_id=%s AND m.user_id=%s
                ORDER BY ms.scheduled_time LIMIT 1
                """,
                (medicine_id, session["user_id"]),
            )
        schedule = cur.fetchone()
        if not schedule:
            return json_error("Medicine schedule not found.", 404)

        ensure_today_logs(conn, session["user_id"])
        status = "Taken" if action == "take" else "Skipped"
        taken_time_sql = "NOW()" if action == "take" else "NULL"
        cur.execute(
            f"""
            UPDATE medication_logs
            SET status=%s, taken_time={taken_time_sql}
            WHERE user_id=%s AND medicine_id=%s AND schedule_id=%s AND scheduled_date=%s
            """,
            (status, session["user_id"], medicine_id, schedule["id"], today),
        )
        if cur.rowcount == 0:
            return json_error("Today's medication log was not found.", 404)
        conn.commit()
        return jsonify({"success": True, "status": status})
    except ValueError as exc:
        conn.rollback()
        return json_error(str(exc))
    except Exception:
        conn.rollback()
        return json_error("Unable to update medication status.", 500)
    finally:
        close_db(conn, cur)


@app.route("/take-medicine/<int:medicine_id>", methods=["POST"])
@login_required
def take_medicine(medicine_id):
    return medication_action("take", forced_medicine_id=medicine_id)


@app.route("/skip-medicine", methods=["POST"])
@login_required
def skip_medicine():
    return medication_action("skip")


@app.route("/api/today-medicines")
@login_required
def today_medicines():
    conn = get_db()
    try:
        rows = fetch_today_schedule(conn, session["user_id"])
        return jsonify([
            {
                "medicine_id": r["medicine_id"],
                "schedule_id": r["schedule_id"],
                "medicine_name": r["medicine_name"],
                "dosage": r["dosage"],
                "scheduled_time": format_time(r["scheduled_time"]),
                "instructions": r.get("instructions") or "",
                "status": r["status"],
            } for r in rows
        ])
    except mysql.connector.Error:
        return json_error("Database error.", 500)
    finally:
        close_db(conn)


@app.route("/api/notifications")
@login_required
def notifications():
    conn = get_db()
    try:
        rows = fetch_today_schedule(conn, session["user_id"])
        now=datetime.now()
        for r in rows:
            if r["status"] in ("Pending", "Missed"):
                scheduled=datetime.combine(date.today(), r["scheduled_time"])
                ntype="due" if scheduled <= now else "upcoming"
                msg=f"💊 {r['medicine_name']} is due at {format_time_display(r['scheduled_time'])}" if ntype=="due" else f"💊 {r['medicine_name']} is scheduled for {format_time_display(r['scheduled_time'])}"
                create_notification(conn,session["user_id"],r["medicine_id"],r["schedule_id"],ntype,msg,scheduled)
        cur=conn.cursor(dictionary=True)
        cur.execute("SELECT id,message,scheduled_for,is_read FROM notifications WHERE user_id=%s ORDER BY created_at DESC LIMIT 50",(session["user_id"],))
        out=[{"id":r["id"],"text":r["message"],"time":r["scheduled_for"].strftime("%I:%M %p"),"read":bool(r["is_read"])} for r in cur.fetchall()]
        cur.close(); return jsonify(out)
    except mysql.connector.Error:
        return json_error("Database error.", 500)
    finally:
        close_db(conn)


@app.route("/history")
@login_required
def history():
    return render_template("dashboard.html", initial_view="history")


@app.route("/api/history")
@login_required
def api_history():
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        ensure_today_logs(conn, session["user_id"])
        clauses = ["l.user_id = %s"]
        params = [session["user_id"]]
        if request.args.get("medicine"):
            clauses.append("m.medicine_name = %s")
            params.append(request.args["medicine"])
        if request.args.get("status"):
            clauses.append("l.status = %s")
            params.append(request.args["status"])
        if request.args.get("search"):
            s = f"%{request.args['search']}%"
            clauses.append("(m.medicine_name LIKE %s OR m.instructions LIKE %s)")
            params.extend([s, s])
        cur.execute(
            f"""
            SELECT l.id, l.scheduled_date, m.medicine_name, m.dosage,
                   l.scheduled_time, l.status, l.taken_time, m.instructions
            FROM medication_logs l
            JOIN medicines m ON m.id=l.medicine_id
            WHERE {' AND '.join(clauses)}
            ORDER BY l.scheduled_date DESC, l.scheduled_time DESC
            LIMIT 1000
            """,
            params,
        )
        rows = cur.fetchall()
        return jsonify([
            {
                "id": r["id"],
                "date": r["scheduled_date"].isoformat(),
                "medicine": r["medicine_name"],
                "dosage": r["dosage"],
                "scheduledTime": format_time_display(r["scheduled_time"]),
                "status": r["status"],
                "takenAt": r["taken_time"].strftime("%I:%M %p") if r["taken_time"] else "—",
                "notes": r["instructions"] or "",
            } for r in rows
        ])
    finally:
        close_db(conn, cur)


@app.route("/reports")
@login_required
def reports():
    return render_template("dashboard.html", initial_view="reports")


@app.route("/api/reports")
@login_required
def api_reports():
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        ensure_today_logs(conn, session["user_id"])
        cur.execute(
            """
            SELECT status, COUNT(*) AS count
            FROM medication_logs
            WHERE user_id=%s
            GROUP BY status
            """,
            (session["user_id"],),
        )
        counts = {r["status"]: int(r["count"]) for r in cur.fetchall()}
        total = sum(counts.values())
        taken = counts.get("Taken", 0)
        skipped = counts.get("Skipped", 0)
        missed = counts.get("Missed", 0)
        pending = counts.get("Pending", 0)
        adherence = round((taken / total) * 100) if total else 0

        # Last 7 calendar days, Monday-Sunday ordering for the current week.
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        weekly = []
        for i in range(7):
            d = monday + timedelta(days=i)
            cur.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(status='Taken') AS taken
                FROM medication_logs
                WHERE user_id=%s AND scheduled_date=%s
                """,
                (session["user_id"], d),
            )
            row = cur.fetchone()
            day_total = int(row["total"] or 0)
            day_taken = int(row["taken"] or 0)
            pct = round(day_taken / day_total * 100) if day_total else 0
            weekly.append({"label": d.strftime("%a"), "pct": pct, "date": d.isoformat()})
        return jsonify({
            "total": total,
            "taken": taken,
            "skipped": skipped,
            "missed": missed,
            "pending": pending,
            "adherence_percentage": adherence,
            "weekly": weekly,
        })
    finally:
        close_db(conn, cur)


@app.route("/settings", methods=["GET", "POST"])
@login_required
def settings():
    if request.method == "GET":
        return render_template("dashboard.html", initial_view="settings")
    return update_profile()


@app.route("/settings/profile", methods=["POST"])
@login_required
def update_profile():
    data = request.get_json(silent=True) or request.form
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    if not name or not email:
        return json_error("Name and email are required.")
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT id FROM users WHERE email=%s AND id<>%s", (email, session["user_id"]))
        if cur.fetchone():
            return json_error("That email is already in use.", 409)
        cur.execute("UPDATE users SET name=%s, email=%s WHERE id=%s", (name, email, session["user_id"]))
        conn.commit()
        session["user_name"] = name
        return jsonify({"success": True, "message": "Profile updated successfully."})
    except Exception:
        conn.rollback()
        return json_error("Unable to update profile.", 500)
    finally:
        close_db(conn, cur)


@app.route("/settings/password", methods=["POST"])
@login_required
def change_password():
    data = request.get_json(silent=True) or request.form
    current = data.get("current_password") or ""
    new = data.get("new_password") or ""
    confirm = data.get("confirm_password") or ""
    if not current or not new or not confirm:
        return json_error("All password fields are required.")
    if new != confirm:
        return json_error("New passwords do not match.")
    if len(new) < 8:
        return json_error("New password must be at least 8 characters.")
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT password FROM users WHERE id=%s", (session["user_id"],))
        user = cur.fetchone()
        if not user or not check_password_hash(user["password"], current):
            return json_error("Current password is incorrect.", 401)
        cur.execute(
            "UPDATE users SET password=%s WHERE id=%s",
            (generate_password_hash(new), session["user_id"]),
        )
        conn.commit()
        return jsonify({"success": True, "message": "Password updated successfully."})
    except Exception:
        conn.rollback()
        return json_error("Unable to change password.", 500)
    finally:
        close_db(conn, cur)


@app.route("/api/settings/notifications", methods=["POST"])
@login_required
def update_notifications():
    data = request.get_json(silent=True) or request.form
    values = {
        "medicine_reminders": 1 if str(data.get("medicineReminders", "true")).lower() in ("1", "true", "yes", "on") else 0,
        "browser_notifications": 1 if str(data.get("browserNotifications", "true")).lower() in ("1", "true", "yes", "on") else 0,
        "reminder_sound": 1 if str(data.get("reminderSound", "false")).lower() in ("1", "true", "yes", "on") else 0,
        "daily_summary": 1 if str(data.get("dailySummary", "true")).lower() in ("1", "true", "yes", "on") else 0,
    }
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO user_settings (user_id, medicine_reminders, browser_notifications, reminder_sound, daily_summary)
            VALUES (%s,%s,%s,%s,%s)
            ON DUPLICATE KEY UPDATE
              medicine_reminders=VALUES(medicine_reminders),
              browser_notifications=VALUES(browser_notifications),
              reminder_sound=VALUES(reminder_sound),
              daily_summary=VALUES(daily_summary)
        """, (session["user_id"], values["medicine_reminders"], values["browser_notifications"], values["reminder_sound"], values["daily_summary"]))
        conn.commit()
        return jsonify({"success": True, "message": "Notification preferences saved."})
    except Exception:
        conn.rollback(); return json_error("Unable to save notification preferences.", 500)
    finally:
        close_db(conn, cur)



def ensure_user_settings(conn, user_id):
    cur = conn.cursor()
    cur.execute("INSERT IGNORE INTO user_settings (user_id) VALUES (%s)", (user_id,))
    conn.commit()
    cur.close()


def get_user_settings(conn, user_id):
    ensure_user_settings(conn, user_id)
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT medicine_reminders, browser_notifications, reminder_sound, daily_summary FROM user_settings WHERE user_id=%s", (user_id,))
        r = cur.fetchone() or {}
        return {
            "medicineReminders": bool(r.get("medicine_reminders", 1)),
            "browserNotifications": bool(r.get("browser_notifications", 1)),
            "reminderSound": bool(r.get("reminder_sound", 0)),
            "dailySummary": bool(r.get("daily_summary", 1)),
        }
    finally:
        cur.close()


def create_notification(conn, user_id, medicine_id, schedule_id, ntype, message, scheduled_for):
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO notifications (user_id, medicine_id, schedule_id, notification_type, message, scheduled_for)
            SELECT %s,%s,%s,%s,%s,%s FROM DUAL
            WHERE NOT EXISTS (
                SELECT 1 FROM notifications
                WHERE user_id=%s AND medicine_id=%s AND IFNULL(schedule_id,0)=IFNULL(%s,0)
                  AND notification_type=%s AND DATE(scheduled_for)=DATE(%s)
            )
        """, (user_id, medicine_id, schedule_id, ntype, message, scheduled_for,
              user_id, medicine_id, schedule_id, ntype, scheduled_for))
        conn.commit()
    finally:
        cur.close()


@app.route("/api/remind-later", methods=["POST"])
@login_required
def remind_later():
    data = request.get_json(silent=True) or request.form
    medicine_id = data.get("medicine_id")
    schedule_id = data.get("schedule_id")
    minutes = int(data.get("minutes", 15)) if str(data.get("minutes", "15")).isdigit() else 15
    if minutes not in (5, 15, 30):
        return json_error("Reminder delay must be 5, 15, or 30 minutes.")
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        cur.execute("""
            SELECT l.id FROM medication_logs l
            JOIN medicines m ON m.id=l.medicine_id
            WHERE l.user_id=%s AND l.medicine_id=%s AND l.schedule_id=%s AND l.scheduled_date=%s
              AND m.user_id=%s AND l.status='Pending'
            LIMIT 1
        """, (session["user_id"], int(medicine_id), int(schedule_id), date.today(), session["user_id"]))
        row=cur.fetchone()
        if not row: return json_error("Pending medication log not found.",404)
        until=datetime.now()+timedelta(minutes=minutes)
        cur.execute("UPDATE medication_logs SET snoozed_until=%s WHERE id=%s",(until,row["id"]))
        conn.commit()
        return jsonify({"success":True,"message":f"Reminder postponed for {minutes} minutes.","snoozed_until":until.isoformat()})
    except Exception:
        conn.rollback(); return json_error("Unable to postpone reminder.",500)
    finally: close_db(conn,cur)


@app.route("/api/medicine/<int:medicine_id>")
@login_required
def medicine_detail(medicine_id):
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        cur.execute("SELECT id,medicine_name,dosage,frequency,start_date,end_date,instructions FROM medicines WHERE id=%s AND user_id=%s",(medicine_id,session["user_id"]))
        med=cur.fetchone()
        if not med: return json_error("Medicine not found.",404)
        cur.execute("SELECT id,scheduled_time FROM medicine_schedules WHERE medicine_id=%s ORDER BY scheduled_time",(medicine_id,))
        schedules=cur.fetchall()
        cur.execute("SELECT COUNT(*) total, SUM(status='Taken') taken, SUM(status='Skipped') skipped, SUM(status='Missed') missed FROM medication_logs WHERE user_id=%s AND medicine_id=%s",(session["user_id"],medicine_id))
        stats=cur.fetchone() or {}
        total=int(stats.get("total") or 0); taken=int(stats.get("taken") or 0)
        med["schedules"]= [format_time_display(x["scheduled_time"]) for x in schedules]
        med["startDate"]=med["start_date"].isoformat(); med["endDate"]=med["end_date"].isoformat() if med["end_date"] else None
        med["adherence"]=round(taken/total*100) if total else 0
        med["taken"]=taken; med["skipped"]=int(stats.get("skipped") or 0); med["missed"]=int(stats.get("missed") or 0)
        return jsonify(med)
    finally: close_db(conn,cur)


@app.route("/api/calendar")
@login_required
def calendar_api():
    raw=request.args.get("date") or date.today().isoformat()
    try: selected=parse_date(raw,True)
    except ValueError as e: return json_error(str(e))
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        ensure_today_logs(conn,session["user_id"],selected if selected==date.today() else selected)
        cur.execute("""
            SELECT l.id,l.scheduled_time,l.status,l.taken_time,m.medicine_name,m.dosage
            FROM medication_logs l JOIN medicines m ON m.id=l.medicine_id
            WHERE l.user_id=%s AND l.scheduled_date=%s
            ORDER BY l.scheduled_time,m.medicine_name
        """,(session["user_id"],selected))
        rows=cur.fetchall()
        return jsonify({"date":selected.isoformat(),"items":[{"id":r["id"],"medicine":r["medicine_name"],"dosage":r["dosage"],"time":format_time_display(r["scheduled_time"]),"status":r["status"],"takenAt":r["taken_time"].strftime("%I:%M %p") if r["taken_time"] else None} for r in rows]})
    finally: close_db(conn,cur)


@app.route("/api/streak")
@login_required
def streak_api():
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        ensure_today_logs(conn,session["user_id"])
        cur.execute("""
            SELECT scheduled_date,
                   SUM(status='Pending') pending,
                   SUM(status='Taken') taken,
                   COUNT(*) total
            FROM medication_logs WHERE user_id=%s
            GROUP BY scheduled_date ORDER BY scheduled_date DESC
        """,(session["user_id"],))
        rows=cur.fetchall(); streak=0
        for r in rows:
            if int(r["total"] or 0)>0 and int(r["pending"] or 0)==0 and int(r["taken"] or 0)==int(r["total"] or 0): streak+=1
            else: break
        return jsonify({"streak":streak})
    finally: close_db(conn,cur)


@app.route("/api/notifications/history")
@login_required
def notification_history():
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        cur.execute("""
            SELECT n.id,n.message,n.notification_type,n.scheduled_for,n.is_read,m.medicine_name
            FROM notifications n LEFT JOIN medicines m ON m.id=n.medicine_id
            WHERE n.user_id=%s ORDER BY n.created_at DESC LIMIT 100
        """,(session["user_id"],))
        rows=cur.fetchall()
        return jsonify([{"id":r["id"],"message":r["message"],"type":r["notification_type"],"medicine":r["medicine_name"],"time":r["scheduled_for"].strftime("%d %b %Y, %I:%M %p"),"read":bool(r["is_read"])} for r in rows])
    finally: close_db(conn,cur)


@app.route("/api/notifications/read", methods=["POST"])
@login_required
def notification_read():
    data=request.get_json(silent=True) or {}
    conn=get_db(); cur=conn.cursor()
    try:
        if data.get("all"):
            cur.execute("UPDATE notifications SET is_read=1 WHERE user_id=%s",(session["user_id"],))
        elif data.get("id"):
            cur.execute("UPDATE notifications SET is_read=1 WHERE id=%s AND user_id=%s",(int(data["id"]),session["user_id"]))
        conn.commit(); return jsonify({"success":True})
    except Exception:
        conn.rollback(); return json_error("Unable to update notifications.",500)
    finally: close_db(conn,cur)


@app.route("/api/upcoming")
@login_required
def upcoming_api():
    conn=get_db(); cur=conn.cursor(dictionary=True)
    try:
        ensure_today_logs(conn,session["user_id"])
        cur.execute("""
            SELECT l.medicine_id,l.schedule_id,l.scheduled_time,l.status,l.snoozed_until,m.medicine_name,m.dosage
            FROM medication_logs l JOIN medicines m ON m.id=l.medicine_id
            WHERE l.user_id=%s AND l.scheduled_date=%s AND l.status='Pending'
            ORDER BY l.scheduled_time LIMIT 10
        """,(session["user_id"],date.today()))
        now=datetime.now(); out=[]
        for r in cur.fetchall():
            scheduled=datetime.combine(date.today(), r["scheduled_time"])
            target=r["snoozed_until"] if r["snoozed_until"] and r["snoozed_until"]>scheduled else scheduled
            if target < now: target=now
            out.append({"medicine_id":r["medicine_id"],"schedule_id":r["schedule_id"],"medicine_name":r["medicine_name"],"dosage":r["dosage"],"scheduled_time":format_time_display(r["scheduled_time"]),"target":target.isoformat(),"status":r["status"]})
        return jsonify(out)
    finally: close_db(conn,cur)


@app.route("/export/csv")
@login_required
def export_csv():
    conn = get_db()
    cur = conn.cursor(dictionary=True)
    try:
        cur.execute(
            """
            SELECT l.scheduled_date, m.medicine_name, m.dosage,
                   l.scheduled_time, l.status, l.taken_time
            FROM medication_logs l
            JOIN medicines m ON m.id=l.medicine_id
            WHERE l.user_id=%s
            ORDER BY l.scheduled_date DESC, l.scheduled_time DESC
            """,
            (session["user_id"],),
        )
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["Date", "Medicine", "Dosage", "Scheduled Time", "Status", "Taken Time"])
        for r in cur.fetchall():
            writer.writerow([
                r["scheduled_date"].isoformat(),
                r["medicine_name"],
                r["dosage"],
                format_time_display(r["scheduled_time"]),
                r["status"],
                r["taken_time"].strftime("%Y-%m-%d %H:%M:%S") if r["taken_time"] else "",
            ])
        response = make_response(output.getvalue())
        response.headers["Content-Type"] = "text/csv; charset=utf-8"
        response.headers["Content-Disposition"] = f'attachment; filename=MediMate_Medication_History_{date.today().isoformat()}.csv'
        return response
    finally:
        close_db(conn, cur)


@app.errorhandler(403)
def forbidden(_):
    if request.path.startswith("/api/") or request.is_json:
        return json_error("You are not authorized to access this resource.", 403)
    return redirect(url_for("dashboard" if "user_id" in session else "login"))


@app.errorhandler(413)
def request_too_large(_):
    return json_error("Request is too large.", 413)


@app.errorhandler(404)
def not_found(_):
    if request.path.startswith("/api/"):
        return json_error("Resource not found.", 404)
    return redirect(url_for("home"))


@app.errorhandler(500)
def internal_error(_):
    if request.path.startswith("/api/") or request.is_json:
        return json_error("An unexpected server error occurred.", 500)
    return "An unexpected server error occurred.", 500



def ensure_schema_extensions():
    """Create optional v4 feature tables/columns on existing MediMate databases."""
    conn = get_db(); cur = conn.cursor()
    try:
        cur.execute("""CREATE TABLE IF NOT EXISTS user_settings (
            user_id INT PRIMARY KEY,
            medicine_reminders TINYINT(1) NOT NULL DEFAULT 1,
            browser_notifications TINYINT(1) NOT NULL DEFAULT 1,
            reminder_sound TINYINT(1) NOT NULL DEFAULT 0,
            daily_summary TINYINT(1) NOT NULL DEFAULT 1,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )""")
        cur.execute("""CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            medicine_id INT NULL,
            schedule_id INT NULL,
            notification_type VARCHAR(40) NOT NULL,
            message VARCHAR(255) NOT NULL,
            scheduled_for DATETIME NOT NULL,
            is_read TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (medicine_id) REFERENCES medicines(id) ON DELETE CASCADE,
            FOREIGN KEY (schedule_id) REFERENCES medicine_schedules(id) ON DELETE SET NULL,
            INDEX idx_notifications_user_created (user_id, created_at)
        )""")
        cur.execute("SHOW COLUMNS FROM medication_logs LIKE 'snoozed_until'")
        if not cur.fetchone():
            cur.execute("ALTER TABLE medication_logs ADD COLUMN snoozed_until DATETIME NULL AFTER taken_time")
        conn.commit()
    finally:
        close_db(conn,cur)


if __name__ == "__main__":
    ensure_schema_extensions()
    app.run(debug=os.getenv("FLASK_DEBUG", "0") == "1")
