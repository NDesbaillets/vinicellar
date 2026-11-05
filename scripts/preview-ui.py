#!/usr/bin/env python3
"""Prépare une revue visuelle sans connexion à Supabase. Aucun build produit.

python3 scripts/preview-ui.py
python3 -m http.server 8000 --directory dist
Ouvrir http://localhost:8000/review/compare.html
"""
import argparse
import pathlib
import shutil
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before-ref', default='1bcfb4d')
args = parser.parse_args()
OUT = ROOT / 'dist'
OUT.mkdir(exist_ok=True)
shutil.copytree(ROOT / 'assets', OUT / 'assets', dirs_exist_ok=True)
# Le fichier de configuration de production n'est pas nécessaire à la revue.
(OUT / 'assets/js/config.js').unlink(missing_ok=True)
review = OUT / 'review'
review.mkdir(exist_ok=True)
shutil.copy2(ROOT / 'tests/fixtures/browser-mock.js', review / 'mock.js')

PAGES = {'catalogue': 'cave', 'fiche': 'fiche', 'ajouter': 'ajouter', 'accueil': 'picker'}
CSP = "default-src 'self'; connect-src 'none'; script-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'self'"
FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&amp;family=Inter:wght@400;500;600;700&amp;display=swap'
for variant in ['before', 'after']:
    dest = review / variant
    if dest.exists():
        shutil.rmtree(dest)
    dest.mkdir(exist_ok=True)
    prefix = '/review/before' if variant == 'before' else ''
    if variant == 'before':
        for name in ['assets/css/app.css', 'assets/js/core.js', *[f'assets/js/{s}.js' for s in PAGES.values()]]:
            p = dest / name
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_bytes(subprocess.check_output(['git', 'show', f'{args.before_ref}:{name}'], cwd=ROOT))
    for page, script in PAGES.items():
        (dest / f'{page}.html').write_text(f'''<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="{CSP}"><title>Revue Vinicellar · {variant} · données fictives</title><link rel="stylesheet" href="{FONTS}"><link rel="stylesheet" href="{prefix}/assets/css/app.css"><script src="/review/mock.js"></script><script src="{prefix}/assets/js/core.js"></script><script defer src="{prefix}/assets/js/{script}.js"></script></head><body class="app"><header id="topbar"></header><main class="wrap" id="main"><p class="loading" role="status">Chargement…</p></main><nav id="tabbar"></nav></body></html>''')

# Les liens de navigation restent dans l'environnement fictif.
app = OUT / 'app'
app.mkdir(exist_ok=True)
for page, script in PAGES.items():
    shutil.copy2(review / 'after' / f'{page}.html', app / ('index.html' if script == 'picker' else f'{script}.html'))
for path in app.glob('*.html'):
    if path.name not in ['index.html', 'cave.html', 'fiche.html', 'ajouter.html']:
        path.unlink()
landing = (ROOT / 'index.html').read_text()
landing = '\n'.join(line for line in landing.splitlines() if not any(x in line for x in ['cdn.jsdelivr.net/npm/@supabase', 'src="/assets/js/config.js', 'src="/assets/js/auth.js']))
landing = landing.replace('<script src="/assets/js/core.js', '<script src="/review/mock.js"></script>\n  <script src="/assets/js/core.js')
landing = landing.replace("connect-src 'self' https://*.supabase.co", "connect-src 'none'")
(OUT / 'index.html').write_text(landing)
shutil.copy2(ROOT / 'credits.html', OUT / 'credits.html')
(review / 'mobile.html').write_text('''<!doctype html><html lang="fr"><meta charset="utf-8"><title>Vinicellar mobile</title><style>body{margin:0;background:#e8e8e3;font:14px Arial}header{padding:12px;background:white}main{display:flex;justify-content:center;padding:16px}iframe{border:0}</style><header>Démonstration · données fictives · écran de 390 px</header><main><iframe title="Catalogue mobile" width="390" height="1800" src="after/catalogue.html?loc=home"></iframe></main></html>''')
(review / 'compare.html').write_text('''<!doctype html><html lang="fr"><meta charset="utf-8"><title>Vinicellar — Avant / Après</title><style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#eceee5;font:14px Arial;color:#262c25}.pair{display:flex;justify-content:center;gap:20px}.panel{width:600px;height:840px;overflow:hidden;border-radius:12px;background:white}h1{font:24px Georgia;margin:0 0 6px}p{margin:0 0 16px;color:#535d50}h2{font:16px Arial;margin:0;padding:12px 20px;border-bottom:1px solid #ddd}iframe{border:0;width:1280px;height:1760px;transform:scale(.46875);transform-origin:top left}</style><h1>Vinicellar · Terroir contemporain</h1><p>Avant / après — mêmes données fictives. Bouteilles illustratives, sans génération Studio.</p><div class="pair"><section class="panel"><h2>Avant</h2><iframe title="Avant" src="before/catalogue.html?loc=home"></iframe></section><section class="panel"><h2>Après · Phase A</h2><iframe title="Après" src="after/catalogue.html?loc=home"></iframe></section></div></html>''')
for width in [320, 390, 768, 1280, 1536]:
    (review / f'width-{width}.html').write_text(f'<!doctype html><html><title>QA {width}</title><body><iframe title="QA responsive" width="{width}" height="1600" style="border:0" src="after/catalogue.html?loc=home"></iframe></body></html>')
print(f'Revue préparée dans {OUT} ; aucun accès Supabase, CSP connect-src none.')
