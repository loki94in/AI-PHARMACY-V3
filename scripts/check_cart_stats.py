import urllib.request, json

cart_res = json.loads(urllib.request.urlopen('http://localhost:5175/api/pharmarack/cart').read())
distributors = cart_res.get('distributors', [])

total_items = sum(len(d.get('items', [])) for d in distributors)
total_qty = sum(sum(it.get('qty', 1) for it in d.get('items', [])) for d in distributors)
total_amt = sum(sum(it.get('amount', 0) for it in d.get('items', [])) for d in distributors)

print(f"Distributors: {len(distributors)}, Products: {total_items}, Total Qty: {total_qty}, Total Amt: {total_amt}")
