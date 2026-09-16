import sqlite3

conn = sqlite3.connect('data/app.db')
c = conn.cursor()
c.execute("SELECT id, name, phone, contact FROM distributors WHERE name LIKE '%A.S%' OR name LIKE '%AS %' OR name LIKE '%DEVESH%'")
print('DEV DB dists:', c.fetchall())
