import os
import sys
from datetime import date, timedelta
import mysql.connector
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
load_dotenv(os.path.join(ROOT, ".env"))

DB = dict(
    host=os.getenv("DB_HOST", "localhost"),
    user=os.getenv("DB_USER", "root"),
    password=os.getenv("DB_PASSWORD", ""),
    database=os.getenv("DB_NAME", "medimate_db"),
)

conn = mysql.connector.connect(**DB)
cur = conn.cursor(dictionary=True)

demo_email = "demo@medimate.com"
cur.execute("SELECT id FROM users WHERE email=%s", (demo_email,))
row = cur.fetchone()

if row:
    user_id = row["id"]
else:
    cur.execute(
        "INSERT INTO users (name,email,password) VALUES (%s,%s,%s)",
        ("Demo User", demo_email, generate_password_hash("Demo@123")),
    )
    user_id = cur.lastrowid

# Seed only fictional demo medicines if the demo user has none.
cur.execute("SELECT COUNT(*) AS n FROM medicines WHERE user_id=%s", (user_id,))
if cur.fetchone()["n"] == 0:
    today = date.today()
    medicines = [
        ("Vitamin D", "1 Tablet (1000 IU)", "Once Daily", today - timedelta(days=10), today + timedelta(days=30), "After breakfast with water", ["09:00"]),
        ("Calcium", "1 Tablet (500mg)", "Once Daily", today - timedelta(days=10), today + timedelta(days=15), "After lunch", ["14:00"]),
        ("Paracetamol", "1 Tablet (650mg)", "As Needed", today, today + timedelta(days=7), "Use only as directed on your prescription.", []),
        ("Amoxicillin", "500mg Capsule", "Twice Daily", today - timedelta(days=5), today + timedelta(days=5), "Take with a full glass of water", ["08:00", "20:00"]),
    ]
    for name, dosage, freq, start, end, instructions, times in medicines:
        cur.execute(
            """INSERT INTO medicines
               (user_id,medicine_name,dosage,frequency,start_date,end_date,instructions)
               VALUES (%s,%s,%s,%s,%s,%s,%s)""",
            (user_id,name,dosage,freq,start,end,instructions),
        )
        med_id = cur.lastrowid
        for t in times:
            cur.execute(
                "INSERT INTO medicine_schedules (medicine_id,scheduled_time) VALUES (%s,%s)",
                (med_id,t),
            )

conn.commit()
cur.close()
conn.close()

print("Demo account ready:")
print("Email: demo@medimate.com")
print("Password: Demo@123")
