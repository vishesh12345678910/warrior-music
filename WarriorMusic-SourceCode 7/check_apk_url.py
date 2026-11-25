import re

with open('apk_inspect/classes.dex', 'rb') as f:
    dex = f.read()
    urls = re.findall(rb'https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\x00\"\'\s]*', dex)
    for u in sorted(set(urls)):
        print(u.decode('latin1', 'ignore'))
