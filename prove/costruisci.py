"""Copia public/ in site/, sostituisce Firebase con lo stub in memoria e i Google Fonts con file locali."""
import os, shutil, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "public")
SITE = os.path.join(HERE, "_sito")
shutil.rmtree(SITE, ignore_errors=True)
shutil.copytree(SRC, SITE)
shutil.copy(os.path.join(HERE, "finto", "firebase.js"), os.path.join(SITE, "firebase-stub.js"))

# Font locali
fdir = os.path.join(SITE, "fonts"); os.makedirs(fdir)
F = os.path.join(HERE, "node_modules", "@fontsource")
faces = []
for w in (400, 500, 600):
    n = f"instrument-sans-latin-{w}-normal.woff2"
    shutil.copy(os.path.join(F, "instrument-sans", "files", n), fdir)
    faces.append(f'@font-face{{font-family:"Instrument Sans";font-weight:{w};src:url(/fonts/{n})}}')
for st in ("normal", "italic"):
    n = f"instrument-serif-latin-400-{st}.woff2"
    shutil.copy(os.path.join(F, "instrument-serif", "files", n), fdir)
    faces.append(f'@font-face{{font-family:"Instrument Serif";font-style:{st};src:url(/fonts/{n})}}')
open(os.path.join(fdir, "fonts.css"), "w").write("\n".join(faces))

im = '''<script type="importmap">{"imports":{
"https://www.gstatic.com/firebasejs/11.3.0/firebase-app.js":"/firebase-stub.js",
"https://www.gstatic.com/firebasejs/11.3.0/firebase-auth.js":"/firebase-stub.js",
"https://www.gstatic.com/firebasejs/11.3.0/firebase-firestore.js":"/firebase-stub.js",
"https://www.gstatic.com/firebasejs/11.3.0/firebase-functions.js":"/firebase-stub.js",
"https://www.gstatic.com/firebasejs/11.3.0/firebase-messaging.js":"/firebase-stub.js"}}</script>
'''
# L'app e la pagina di consenso del connettore per claude.ai (22/11): font locali e Firebase finto.
for pagina, script in (("index.html", "/js/app.js"), ("collega-claude.html", "/js/collega-claude.js")):
    html = open(os.path.join(SITE, pagina)).read()
    html = re.sub(r'<link rel="stylesheet" media="print"[^>]*>', '<link rel="stylesheet" href="/fonts/fonts.css">', html)
    html = html.replace('<link rel="preconnect" href="https://fonts.googleapis.com">', "").replace('<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>', "")
    html = html.replace(f'<script type="module" src="{script}"></script>', im + f'<script type="module" src="{script}"></script>')
    open(os.path.join(SITE, pagina), "w").write(html)
open(os.path.join(SITE, "sw.js"), "w").write("// disattivato nella prova\n")
print("site pronto")
