import sqlite3, os

db_path = os.path.expandvars(r'%LOCALAPPDATA%\AI Pharmacy OS\data\app.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("SELECT * FROM pharmarack_distributor_mappings WHERE store_name LIKE '%Devesh%'")
print('pharmarack_distributor_mappings:', c.fetchall())
