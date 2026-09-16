import sqlite3, os

db_path = os.path.expandvars(r'%LOCALAPPDATA%\AI Pharmacy OS\data\app.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in c.fetchall()]

found = False
for t in tables:
    try:
        c.execute(f'SELECT * FROM "{t}"')
        for r in c.fetchall():
            s = str(r).lower()
            if 'devesh' in s or 'medisales' in s or 'a.s.' in s or 'as distributor' in s:
                print(f'FOUND IN {t}:', r)
                found = True
    except Exception as e:
        pass

if not found:
    print('NOT FOUND IN ANY TABLE!')
