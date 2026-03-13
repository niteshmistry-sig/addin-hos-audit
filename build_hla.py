#!/usr/bin/env python3
"""Build script to inline CSS and JS into docs/index.html"""
import os, json, shutil

root = '/Users/niteshmistry/addin-hos-audit'
src = os.path.join(root, 'src')
docs = os.path.join(root, 'docs')

with open(os.path.join(src, 'index.html')) as f:
    html = f.read()

# Inline CSS via JavaScript injection (MyGeotab strips <style> tags)
with open(os.path.join(src, 'css', 'style.css')) as f:
    css = f.read()
css_json = json.dumps(css)  # properly escape for JS string
css_injector = (
    '<script>\n'
    '(function(){\n'
    '  var s=document.createElement("style");\n'
    '  s.setAttribute("data-hla","true");\n'
    '  s.textContent=' + css_json + ';\n'
    '  (document.head||document.documentElement).appendChild(s);\n'
    '})();\n'
    '</script>'
)
css_tag = '<link rel="stylesheet" href="css/style.css">'
html = html.replace(css_tag, css_injector)

# Inline JS
js_files = ['constants.js', 'auditService.js', 'dataProcessor.js', 'auditTable.js', 'main.js']
for fn in js_files:
    path = os.path.join(src, 'js', fn)
    if os.path.exists(path):
        with open(path) as f:
            js = f.read()
        script_tag = '<script src="js/' + fn + '"></script>'
        html = html.replace(script_tag, '<script>\n' + js + '\n</script>')

with open(os.path.join(docs, 'index.html'), 'w') as f:
    f.write(html)

# Copy config.json to docs so it's served on GitHub Pages
shutil.copy2(os.path.join(root, 'config.json'), os.path.join(docs, 'config.json'))

# Copy icon to docs
icon_src = os.path.join(docs, 'images', 'icon.svg')
if os.path.exists(icon_src):
    print(f'Icon already in place: docs/images/icon.svg')

size_kb = os.path.getsize(os.path.join(docs, 'index.html')) // 1024
print(f'Build complete: docs/index.html ({size_kb} KB)')
print(f'Config synced: docs/config.json')
