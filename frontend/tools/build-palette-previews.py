"""Isolated colour-only copies of the production build. Live API data is unchanged."""
from pathlib import Path
import json, re, shutil, hashlib

base = Path(__file__).resolve().parents[1]
root = base / '_mockups' / 'palette'
variants = [
    dict(id='a', name='Graphite / Sage', map='cork', crop=[64,191], background='#151e22', surface='#202d30', ink='#e4e9e5', muted='#afbeb9', rule='#465957', blue='#a5c2b4', orange='#b8ccb7', ocean='#19282d', land='#34494b'),
    dict(id='b', name='Midnight / Mineral', map='broc', crop=[64,191], background='#181e2a', surface='#252e3d', ink='#e4e8ef', muted='#b1bdce', rule='#4a5970', blue='#b4c7e2', orange='#c8c8ac', ocean='#1c2a3d', land='#394b5d'),
    dict(id='c', name='Slate / Rose', map='vik', crop=[80,175], background='#242127', surface='#322e36', ink='#eae5e6', muted='#c3b9c1', rule='#625761', blue='#b8c7d8', orange='#d5b9b4', ocean='#292b38', land='#494750'),
]
rgb = lambda h: [int(h[i:i+2],16) for i in (1,3,5)]
for v in variants:
    dst=root/v['id'];shutil.copytree(base/'dist',dst,dirs_exist_ok=True)
    table=[[round(float(x)*255) for x in line.split()] for line in (root/(v['map']+'.txt')).read_text().splitlines()]
    table=table[v['crop'][0]:v['crop'][1]+1]
    v['ramp']=[table[0],table[len(table)//2],table[-1]]
    for source in (base/'dist'/'assets').glob('index-*.js'):
        f=dst/'assets'/source.name
        s=f.read_text(encoding='utf-8')
        match=re.search(r'function ([\w$]+)\((\w+),(\w+)\)\{let \w+=\w+<0\?\[\[199,207,203\]',s)
        assert match, 'Build ramp changed; review preview patch'
        end=s.index('function ',match.start()+10)
        name,a,b=match.groups()
        fn='function '+name+'('+a+','+b+'){const colors='+json.dumps(table,separators=(',',':'))+';const pos=(Math.max(-1,Math.min(1,'+a+'/Math.max('+b+',Number.MIN_VALUE)))+1)*.5*(colors.length-1),i=Math.floor(pos),j=Math.min(colors.length-1,i+1),f=pos-i;return "rgb("+colors[i].map((v,k)=>Math.round(v+(colors[j][k]-v)*f)).join(",")+")";}'
        s=s[:match.start()]+fn+s[end:]
        old='vec3(0.075,0.157,0.212),vec3(0.169,0.255,0.294)'
        new=','.join('vec3('+','.join(f'{x/255:.6f}' for x in rgb(v[k]))+')' for k in ['ocean','land'])
        assert s.count(old)==1;s=s.replace(old,new)
        f.write_text(s,encoding='utf-8')
    ramp='linear-gradient(90deg,'+','.join('rgb('+','.join(map(str,c))+')' for c in table[::8]+[table[-1]])+')'
    variables=';'.join('--'+k+':'+v[k] for k in ['background','surface','ink','muted','rule','blue','orange'])
    css=':root,.globe-shell .drawer{'+variables+';--input:'+v['muted']+'}body,.globe-shell{background:var(--background);color:var(--ink)}'
    css+='.globe-conclusion,.globe-header,.globe-time-strip,.globe-footer,.globe-shell .drawer,.globe-shell .drawer-heading{background:var(--background)!important}'
    css+='.globe-shell .drawer-heading,.globe-shell .drawer::backdrop{background:'+v['background']+'!important}.globe-shell .drawer::backdrop{opacity:.72}'
    css+='.globe-view[data-zoomed=true] .globe-legend,.globe-view[data-zoomed=true] .globe-centre,.globe-stage:has(.globe-view[data-zoomed=true]) .globe-coverage{background:var(--background)}'
    css+='.globe-legend i{background:'+ramp+'}.globe-conclusion{border-color:var(--rule)}.globe-shell :focus-visible{outline-color:var(--orange)}'
    css+='.globe-shell .button-primary{background:var(--orange);color:var(--background);border-color:var(--orange)}.globe-shell .drawer input,.globe-shell .drawer select{background:var(--surface);color:var(--ink)}'
    (dst/'palette.css').write_text(css,encoding='utf-8')
    p=dst/'index.html';p.write_text(p.read_text(encoding='utf-8').replace('</head>','<link rel="stylesheet" href="/palette.css"></head>'),encoding='utf-8')
def luminance(h):
    values=[x/255 for x in rgb(h)]
    return sum(w*(x/12.92 if x<=.04045 else ((x+.055)/1.055)**2.4) for w,x in zip([.2126,.7152,.0722],values))
for v in variants:
    v['contrastRatios']={}
    for foreground in ['ink','muted','blue','orange']:
        for background in ['background','surface']:
            a,b=sorted([luminance(v[foreground]),luminance(v[background])])
            ratio=round((b+.05)/(a+.05),2);assert ratio>=4.5
            v['contrastRatios'][foreground+'/'+background]=ratio
manifest={str(p.relative_to(base)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (base/'dist').rglob('*') if p.is_file()}
(root/'source-build-sha256.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
(root/'variants.json').write_text(json.dumps(variants,indent=2),encoding='utf-8')
print('Three isolated build copies; frontend/src and working palette unchanged.')
