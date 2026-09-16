import json, urllib.request

res = json.loads(urllib.request.urlopen('http://localhost:5175/api/distributors').read())
dists = res if isinstance(res, list) else res.get('distributors', [])

def normalizeDistName(rawName):
    if not rawName:
        return ''
    import re
    s = rawName.lower().strip()
    s = re.sub(r'\(.*?\)', '', s)
    s = re.sub(r'pvt|ltd|limited|private|distributors|distributor|pharma|pharmaceuticals|agency|agencies|medicals|medical|co|and|llp|delivery|surgical|surgicals|generic', '', s, flags=re.IGNORECASE)
    return re.sub(r'[^a-z0-9]', '', s)

target = 'A.S. Distributors'
normCart = normalizeDistName(target)
rawCartNorm = ''.join(c for c in target.lower() if c.isalnum())

print(f"target: '{target}'")
print(f"normCart: '{normCart}', rawCartNorm: '{rawCartNorm}'")

for d in dists:
    name = d.get('name', '')
    phone = d.get('phone') or d.get('contact') or ''
    if not phone:
        continue
    normSaved = normalizeDistName(name)
    rawSavedNorm = ''.join(c for c in name.lower() if c.isalnum())
    
    match1 = normCart and normSaved and (normCart in normSaved or normSaved in normCart)
    match2 = rawCartNorm and rawSavedNorm and (rawCartNorm in rawSavedNorm or rawSavedNorm in rawCartNorm)
    if match1 or match2:
        print(f"MATCHED: '{name}', phone: '{phone}', normSaved: '{normSaved}', match1: {match1}, match2: {match2}")
