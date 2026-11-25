import urllib.request, json

ids = ['k5mX3nTvH_s', 'g6fnFALEseI', 'WWXm46vTmrA', 'jsb9BUJaiUY', '284Ov7ysmfA', 'dr_vaL8gq_U', 'liL45WlA6kM', 'YUtHjVBUZ0c', 'vsl3gBVO2k4', 'B4c_SkROzzo']
for vid in ids:
    url = f'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={vid}&format=json'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        res = urllib.request.urlopen(req, timeout=3)
        data = json.loads(res.read())
        title = data.get('title', '')
        print(f'{vid}: OK -> {title[:40]}')
    except Exception as e:
        print(f'{vid}: FAILED -> {e}')
