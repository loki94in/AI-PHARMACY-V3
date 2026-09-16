import urllib.request, json, sqlite3, os

# Fetch cart
cart_res = json.loads(urllib.request.urlopen('http://localhost:5175/api/pharmarack/cart').read())
distributors = cart_res.get('distributors', [])

# Connect to DB
db_path = os.path.expandvars(r'%LOCALAPPDATA%\AI Pharmacy OS\data\app.db')
conn = sqlite3.connect(db_path)
c = conn.cursor()

c.execute("SELECT * FROM pharmarack_distributor_mappings")
mappings = c.fetchall()
print("Total mappings in DB:", len(mappings))
for m in mappings:
    print("  Mapping:", m)

c.execute("SELECT id, name, phone, contact FROM distributors")
dists_db = c.fetchall()
print("\nTotal distributors in DB:", len(dists_db))

# Check each of the 17 cart distributors
print("\n--- 17 CART DISTRIBUTORS ---")
for d in distributors:
    s_id = d.get('storeId')
    s_name = d.get('storeName')
    
    # 1. Exact match in mappings
    c.execute("SELECT * FROM pharmarack_distributor_mappings WHERE LOWER(TRIM(store_name)) = LOWER(TRIM(?))", [s_name])
    map_row = c.fetchone()
    
    # 2. Exact match in distributors
    c.execute("SELECT * FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))", [s_name])
    dist_row = c.fetchone()
    
    # 3. Fuzzy / normalized
    clean_s = ''.join(ch for ch in s_name.lower() if ch.isalnum())
    fuzzy_matches = []
    for row in dists_db:
        clean_d = ''.join(ch for ch in (row[1] or '').lower() if ch.isalnum())
        if clean_s and clean_d and (clean_s in clean_d or clean_d in clean_s):
            fuzzy_matches.append(row)
            
    print(f"Store #{s_id}: '{s_name}'")
    print(f"   Mapping exact: {map_row}")
    print(f"   Dist exact: {dist_row}")
    print(f"   Fuzzy matches in distributors: {fuzzy_matches}")
