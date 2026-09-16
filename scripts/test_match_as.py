import json, urllib.request

res = json.loads(urllib.request.urlopen('http://localhost:5175/api/distributors').read())
dists = res if isinstance(res, list) else res.get('distributors', [])

def norm(s):
    return ''.join(c for c in s.lower() if c.isalnum())

target = 'A.S. Distributors'
target_norm = norm(target)

print(f"Target: '{target}', Norm: '{target_norm}'")
for d in dists:
    d_name = d.get('name', '')
    d_norm = norm(d_name)
    phone = d.get('phone') or d.get('contact') or ''
    if target_norm in d_norm or (d_norm and d_norm in target_norm):
        print(f"MATCH: '{d_name}', phone: '{phone}', d_norm: '{d_norm}'")
