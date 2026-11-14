"""Build presentation-only design studies. Never import into the product.

The coastline is Natural Earth 1:110m. Every trend colour and chart trace is
schematic artwork, not observations, and is labelled inside every exported view.
No source APIs, statistics, interpolation, or product behaviour are implemented.
"""

from pathlib import Path
import html
import json
import math

ROOT = Path(__file__).resolve().parent
LAND = json.loads((ROOT / '_sources' / 'ne_110m_land.geojson').read_text(encoding='utf-8'))

THEMES = {
    'field-atlas': dict(bg='#F3F0E7', ink='#173347', muted='#52636D', rule='#C7CDC8',
                        water='#E3EAE9', land='#CED9D6', blue='#246B99', orange='#A64725',
                        softblue='#ABC4D2', softorange='#DCA78B', pale='#E6DDD0',
                        accent='#A64725', surface='#EAE6DA', title='Georgia', label='A / FIELD ATLAS'),
    'signal-desk': dict(bg='#101E28', ink='#F3F1E7', muted='#AFBFC6', rule='#3C535F',
                        water='#172B36', land='#344A53', blue='#7EBBE0', orange='#E8AF78',
                        softblue='#3F6D8B', softorange='#A8734C', pale='#56666B',
                        accent='#E8AF78', surface='#1B303C', title='Arial', label='B / SIGNAL DESK'),
    'evidence-journal': dict(bg='#FBF8F1', ink='#273A43', muted='#5B696E', rule='#C8CEC9',
                             water='#EDF0EA', land='#D9DFD4', blue='#286C99', orange='#A04429',
                             softblue='#B0C9D7', softorange='#DCAB91', pale='#E4DED0',
                             accent='#A04429', surface='#F0EADF', title='Georgia', label='C / EVIDENCE JOURNAL'),
}


class Drawing:
    def __init__(self, theme, title, height=1040):
        self.t = THEMES[theme]
        self.height = height
        self.parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="{height}" viewBox="0 0 1440 {height}" role="img" aria-labelledby="title desc">',
                      f'<title id="title">{html.escape(title)}</title>',
                      '<desc id="desc">Presentation-only design sketch. All trend colours, traces, results and dates of change are illustrative, not NASA observations. Coastline: Natural Earth.</desc>',
                      '<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 7L7 0M5 9L9 5" stroke="'+self.t['ink']+'" stroke-width="1" opacity=".52"/></pattern></defs>']
        self.rect(0, 0, 1440, height, self.t['bg'])
        self.rect(0, 0, 1440, 32, self.t['ink'])
        self.text(40, 22, 'DESIGN STUDY / ILLUSTRATIVE DATA / NOT A LIVE ANALYSIS', 12, self.t['bg'], mono=True, spacing=1.3)
        self.text(1400, 22, self.t['label'], 12, self.t['bg'], mono=True, anchor='end')

    def add(self, value):
        self.parts.append(value)

    def rect(self, x, y, w, h, fill, stroke='none', rx=0, opacity=1):
        self.add(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" fill="{fill}" stroke="{stroke}" opacity="{opacity}"/>')

    def line(self, x1, y1, x2, y2, color=None, width=1, dash=''):
        self.add(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color or self.t["rule"]}" stroke-width="{width}" stroke-dasharray="{dash}"/>')

    def text(self, x, y, value, size=16, color=None, weight=400, serif=False, mono=False, anchor='start', spacing=0):
        font = 'Consolas, monospace' if mono else ('Georgia, serif' if serif else 'Arial, sans-serif')
        self.add(f'<text x="{x}" y="{y}" fill="{color or self.t["ink"]}" font-family="{font}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" letter-spacing="{spacing}">{html.escape(value)}</text>')

    def lines(self, x, y, values, size=16, leading=24, **kw):
        for i, val in enumerate(values):
            self.text(x, y+i*leading, val, size, **kw)

    def circle(self, x, y, r, fill, stroke='none', width=1):
        self.add(f'<circle cx="{x}" cy="{y}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{width}"/>')

    def button(self, x, y, w, text, primary=False, h=44):
        self.rect(x, y, w, h, self.t['ink'] if primary else self.t['bg'], self.t['ink'])
        self.text(x+w/2, y+h/2+5, text, 14, self.t['bg'] if primary else self.t['ink'], weight=700, anchor='middle')

    def label(self, x, y, text):
        self.text(x, y, text.upper(), 12, self.t['muted'], mono=True, spacing=1.2)

    def header(self, active='Explore'):
        self.text(40, 73, 'EARTH SYSTEM / TRENDS', 15, weight=700, spacing=1)
        for x, word in [(930, 'Explore'), (1060, 'Time series'), (1220, 'Change points')]:
            self.text(x, 73, word, 14, weight=700 if active == word else 400)
            if active == word:
                self.line(x, 86, x+len(word)*7.5, 86, self.t['accent'], 3)
        self.line(40, 102, 1400, 102)

    def field(self, x, y, w, label, value):
        self.label(x, y, label)
        self.text(x, y+28, value, 18)
        self.line(x, y+42, x+w, y+42)
        self.text(x+w-4, y+26, 'v', 14, anchor='end')

    def map(self, x, y, w, h, area=False, show_field=True, uid='main'):
        t = self.t
        # Mercator projection, geographic view only; no hand-drawn coastlines.
        west, east, south, north = -15, 45, 33, 72
        merc = lambda lat: math.log(math.tan(math.pi/4+math.radians(max(-85,min(85,lat)))/2))
        top, bottom = merc(north), merc(south)
        # One scale in both directions: preserve the Mercator projection.
        span_x = math.radians(east-west)
        scale = min(w/span_x, h/(top-bottom))
        center_lon = math.radians((west+east)/2)
        center_y = (top+bottom)/2
        project = lambda lon, lat: (x+w/2+(math.radians(lon)-center_lon)*scale, y+h/2+(center_y-merc(lat))*scale)
        clip = 'mapclip'+uid
        coast = 'coast'+uid
        paths = []
        for feature in LAND['features']:
            geom = feature['geometry']
            polygons = geom['coordinates'] if geom['type'] == 'MultiPolygon' else [geom['coordinates']]
            for poly in polygons:
                ring = poly[0]
                if max(p[0] for p in ring)<west or min(p[0] for p in ring)>east or max(p[1] for p in ring)<south or min(p[1] for p in ring)>north:
                    continue
                pts = [project(*p[:2]) for p in ring]
                paths.append('M'+'L'.join(f'{a:.2f},{b:.2f}' for a,b in pts)+'Z')
        landpath = ' '.join(paths)
        self.add(f'<defs><clipPath id="{clip}"><rect x="{x}" y="{y}" width="{w}" height="{h}"/></clipPath><clipPath id="{coast}"><path d="{landpath}"/></clipPath></defs>')
        self.add(f'<g clip-path="url(#{clip})">')
        self.rect(x, y, w, h, t['water'])
        for lon in range(-10,46,10):
            px,_ = project(lon,45)
            self.line(px,y,px,y+h,t['rule'],.7)
        for lat in [40,50,60,70]:
            _,py = project(0,lat)
            self.line(x,py,x+w,py,t['rule'],.7)
        self.add(f'<path d="{landpath}" fill="{t["land"]}" stroke="{t["muted"]}" stroke-width=".8"/>')
        if show_field:
            self.add(f'<g clip-path="url(#{coast})">')
            # Schematic visual marks only: no numerical trend dataset is created.
            for row in range(17):
                for col in range(25):
                    palette = [t['blue'],t['softblue'],t['pale'],t['softorange'],t['orange']]
                    tone = int(2 + 1.9*math.sin(col*.28-row*.23))
                    cx,cy = x+col*w/25, y+row*h/17
                    cw,ch = w/25-1,h/17-1
                    if (row*3+col)%31 == 0:
                        self.rect(cx,cy,cw,ch,t['land'])
                        self.line(cx+cw*.35,cy+ch*.35,cx+cw*.65,cy+ch*.65,t['ink'])
                        self.line(cx+cw*.65,cy+ch*.35,cx+cw*.35,cy+ch*.65,t['ink'])
                        continue
                    if (row*3+col)%47 == 0:
                        self.rect(cx,cy,cw,ch,t['bg'],t['muted'])
                        continue
                    self.rect(cx,cy,cw,ch,palette[tone],opacity=.86)
                    if (col+row)%4 == 0:
                        self.rect(cx,cy,cw,ch,'url(#hatch)')
            self.add('</g>')
        sx,sy = project(32.5,46.5)
        if area:
            ax,ay=project(25,52)
            bx,by=project(35,44)
            self.rect(ax,ay,bx-ax,by-ay,'none',t['ink'])
            for xx,yy in [(ax,ay),(bx,ay),(ax,by),(bx,by)]:
                self.rect(xx-4,yy-4,8,8,t['bg'],t['ink'])
            self.text(ax+10,ay-10,'SELECTED AREA',12,t['ink'],mono=True)
        else:
            self.circle(sx,sy,15,t['bg'],t['ink'],2)
            self.circle(sx,sy,5,t['accent'])
            self.line(sx,sy+15,sx,y+h,t['ink'],1.5)
        self.rect(x+10,y+9,min(w-20,438),46,t['bg'],opacity=.96)
        self.text(x+18,y+26,'EUROPE / SCHEMATIC TREND FIELD',11,t['ink'],mono=True)
        self.text(x+18,y+46,'MAP: MERRA-2 / 1980–SEP 2026 / MONTHLY DIFFERENCES',11,t['ink'],mono=True)
        self.text(x+w-16,y+h-14,'Made with Natural Earth',11,t['ink'],anchor='end')
        self.add('</g>')
        return sx,sy

    def legend(self, x, y):
        self.text(x,y-8,'−1.0',11,mono=True)
        self.text(x+70,y-8,'0',11,mono=True,anchor='middle')
        self.text(x+140,y-8,'+1.0',11,mono=True,anchor='end')
        for i,key in enumerate(['blue','softblue','pale','softorange','orange']):
            self.rect(x+i*28,y,28,10,self.t[key])
        self.text(x,y+30,'Decrease',12)
        self.text(x+140,y+30,'Increase',12,anchor='end')
        self.text(x+180,y+30,'°C / decade · illustrative scale',11,color=self.t['muted'])
        self.rect(x+180,y-3,20,17,'url(#hatch)',self.t['rule'])
        self.text(x+210,y+10,'Supported · q < 0.05',12)
        self.rect(x+390,y-3,20,17,self.t['bg'],self.t['ink'])
        self.text(x+420,y+10,'No data',12)
        self.rect(x+510,y-3,20,17,self.t['land'],self.t['rule'])
        self.line(x+516,y+2,x+524,y+10,self.t['ink'])
        self.line(x+524,y+2,x+516,y+10,self.t['ink'])
        self.text(x+540,y+10,'Not computed',12)

    def chart(self, x, y, w, h, change=False):
        t=self.t
        self.label(x,y-20,'ILLUSTRATIVE TRACE / NOT OBSERVATIONS')
        plotx,ploty,pw,ph=x+46,y+24,w-80,h-74
        for i in range(5):
            yy=ploty+i*ph/4
            self.line(plotx,yy,plotx+pw,yy,t['rule'],.7)
        self.text(plotx,ploty-10,'Difference from monthly average (°C)',12,t['muted'])
        for val,frac in [('+1.0',0),('0.0',.5),('−1.0',1)]:
            self.text(plotx-12,ploty+ph*frac+4,val,11,t['muted'],mono=True,anchor='end')
        for i,year in enumerate([2000,2005,2010,2015,2020,2025]):
            xx=plotx+i*pw/5
            self.text(xx,ploty+ph+28,str(year),12,t['muted'],mono=True,anchor='middle')
        self.line(plotx,ploty+ph,plotx+pw,ploty+ph,t['muted'])
        trend=lambda xx: ploty+ph*.76-(xx-plotx)/pw*ph*.48
        xx1,xx2=plotx,plotx+pw
        self.line(xx1,trend(xx1),xx2,trend(xx2),t['orange'],2)
        for start,end in [(0,36),(41,81)]:
            points=[]
            for i in range(start,end):
                xx=plotx+pw*i/80
                yy=trend(xx)+ph*(.11*math.sin(i*1.31)+.04*math.cos(i*.45))
                points.append(f'{xx:.1f},{yy:.1f}')
            self.add(f'<polyline points="{" ".join(points)}" fill="none" stroke="{t["blue"]}" stroke-width="2.4"/>')
        self.text(plotx+pw*.46,ploty+ph+50,'Gap in observations — not filled',12,t['muted'],anchor='middle')
        self.text(plotx+pw-8,ploty+16,'Trend guide (illustrative)',12,t['orange'],anchor='end')
        if change:
            bx=plotx+pw*.57
            self.line(bx,ploty-6,bx,ploty+ph,t['ink'],1.5,'5 5')
            self.rect(bx-81,ploty-6,162,26,t['bg'])
            self.text(bx,ploty+12,'Possible change · 2014',12,anchor='middle')
        return plotx,ploty,pw,ph

    def footer(self, label='Design study only · source names describe the proposed interface.'):
        self.line(40,self.height-58,1400,self.height-58)
        self.text(40,self.height-29,label,12,self.t['muted'])
        self.text(1400,self.height-29,'EN / NASA SPACE APPS 2026',12,self.t['muted'],mono=True,anchor='end')

    def save(self, theme, name):
        dest=ROOT/theme
        dest.mkdir(exist_ok=True)
        (dest/(name+'.svg')).write_text('\n'.join(self.parts+['</svg>']),encoding='utf-8')


def atlas():
    name='field-atlas'
    d=Drawing(name,'Field Atlas — main map sketch')
    d.header()
    d.label(48,143,'01 / EXPLORE A CHANGING EARTH')
    d.lines(48,201,['One variable.', 'Different directions.'],50,54,serif=True)
    d.lines(1000,174,['Start with a place.', 'Follow the observations.', 'Understand the evidence.'],20,29)
    d.field(48,300,470,'Variable / mission','Air temperature at 2 m · MERRA-2')
    d.field(560,300,300,'Analysis period','2000 — 2025')
    d.field(910,300,482,'Map view','Europe · prepared trend layer')
    sx,sy=d.map(48,380,936,454)
    # Route around the legend so the thread never crosses its labels.
    d.line(sx,834,sx,840,d.t['ink'],1.5)
    d.line(sx,840,964,840,d.t['ink'],1.5)
    d.line(964,840,964,913,d.t['ink'],1.5)
    d.circle(964,913,4,d.t['ink'])
    d.label(1020,401,'02 / SELECT A PLACE')
    d.button(1020,420,135,'Point',True)
    d.button(1165,420,135,'Area')
    d.text(1020,507,'46.5° N / 32.5° E',23,serif=True)
    d.lines(1020,539,['Analysis uses the nearest grid cell.', 'Live requests also work beyond', 'the prepared European map.'],14,23,color=d.t['muted'])
    d.line(1020,618,1392,618)
    d.label(1020,653,'ILLUSTRATIVE CELL PREVIEW')
    d.text(1020,702,'Increasing',36,serif=True)
    d.text(1020,741,'+0.4 °C / decade',24)
    d.text(1020,774,'Direction is not a cause.',14,color=d.t['muted'])
    d.legend(48,861)
    d.line(48,913,1392,913,d.t['ink'])
    d.label(48,941,'YOUR COORDINATE THREAD')
    d.text(326,943,'MERRA-2  /  2000–2025  /  POINT',15,mono=True)
    d.button(1120,925,272,'Open time series  →',True)
    d.footer()
    d.save(name,'main')

    d=Drawing(name,'Field Atlas — time-series analysis sketch')
    d.header('Time series')
    d.label(48,143,'EUROPE / SELECTED GRID CELL / 46.5° N 32.5° E')
    d.text(48,205,'A direction. And the evidence.',48,serif=True)
    d.text(48,247,'Air temperature at 2 m · MERRA-2 · 2000–2025',18)
    d.button(48,280,160,'Observations')
    d.button(218,280,228,'Monthly differences',True)
    d.text(480,307,'Monthly average based on 2000–2025.',14,color=d.t['muted'])
    d.chart(48,380,944,310)
    d.line(1020,352,1020,720)
    d.label(1050,381,'ILLUSTRATIVE RESULT')
    d.text(1050,433,'Increasing',34,serif=True)
    d.text(1050,487,'+0.4',58,serif=True)
    d.text(1210,484,'°C / decade',17)
    d.text(1050,530,'95% slope CI: +0.2 to +0.6',16)
    d.line(1050,544,1285,544,d.t['orange'],2)
    d.line(1050,539,1050,549,d.t['orange'],2)
    d.line(1285,539,1285,549,d.t['orange'],2)
    d.circle(1168,544,4,d.t['orange'])
    d.lines(1050,568,['Data support a trend under', 'the stated test assumptions.', 'Statistical support does not', 'identify its cause.'],15,24)
    d.text(1050,695,'Mann–Kendall · p = 0.03',14,mono=True)
    d.text(1050,716,'Autocorrelation adjustment: Hamed–Rao',11,color=d.t['muted'])
    d.line(48,746,1392,746,d.t['ink'])
    d.label(48,782,'NEXT / QUESTION A SHARP CHANGE')
    d.text(48,821,'Could a change point affect this trend?',26,serif=True)
    d.lines(48,855,['A possible break and a gradual trend can coexist.', 'Check the evidence before interpreting the cause.'],15,23,color=d.t['muted'])
    d.button(48,914,224,'Inspect change points →',True)
    d.label(890,785,'EONET / SEPARATE CONTEXT')
    d.lines(890,824,['Not checked in this view.', 'No event record is not evidence', 'of a human-caused change.'],17,27)
    d.footer('Illustrative results only · actual tests, intervals, methods and source DOI appear in the product.')
    d.save(name,'analysis')


def signal():
    name='signal-desk'
    d=Drawing(name,'Signal Desk — area request on the main map')
    d.header()
    d.label(40,144,'EARTH OBSERVATIONS / 07 STARTING VARIABLES')
    d.text(40,220,'Inspect the signal.',66,weight=700,spacing=-2)
    d.label(40,284,'VARIABLE / SOURCE')
    variables=[('01','Air temperature','MERRA-2'),('02','Precipitation','GPM IMERG'),('03','Soil moisture','GLDAS'),('04','Evapotranspiration','FLDAS / GLDAS'),('05','Surface runoff','GLDAS'),('06','Air temperature','AIRS'),('07','Tropospheric NO₂','OMI')]
    for i,(num,label,mission) in enumerate(variables):
        yy=329+i*66
        if i==0:d.rect(40,yy-27,252,61,d.t['surface'])
        d.text(49,yy,num,12,d.t['muted'],mono=True)
        d.text(82,yy,label,16,weight=700 if i==0 else 400)
        d.text(82,yy+21,mission,11,d.t['muted'],mono=True)
        d.line(40,yy+33,292,yy+33)
    d.map(324,274,698,514,area=True)
    d.label(1055,292,'SAMPLING GEOMETRY')
    d.button(1055,312,151,'Point')
    d.button(1216,312,184,'Area',True)
    d.text(1055,401,'Area request',32,weight=700)
    d.lines(1055,438,['25–35° E / 44–52° N', '2000–2025'],15,26,mono=True)
    d.line(1055,507,1400,507)
    d.circle(1062,543,6,'none',d.t['orange'],2)
    d.text(1080,549,'QUEUED',13,mono=True)
    d.lines(1055,593,['No saved observations found.', 'Waiting for this area.', 'Estimated retrieval: about', '3 minutes, sometimes longer.', 'No results are shown yet.'],17,27)
    d.text(1055,768,'We will show the actual stage.',13,d.t['muted'])
    d.legend(324,819)
    d.label(40,887,'TIME APERTURE / ANALYSIS PERIOD')
    d.line(470,923,1268,923,d.t['muted'],2)
    for xx,year in [(470,'2000'),(630,'2005'),(790,'2010'),(950,'2015'),(1110,'2020'),(1268,'2025')]:
        d.line(xx,918,xx,929,d.t['muted'])
        d.text(xx,951,year,12,d.t['muted'],mono=True,anchor='middle')
    for xx in [470,1268]:
        d.line(xx,903,xx,939,d.t['orange'],4)
    d.text(40,930,'[ 2000 — 2025 ]',25,mono=True)
    d.footer('Illustrative map marks · queued means no result is available; no fabricated progress percentage.')
    d.save(name,'main')

    d=Drawing(name,'Signal Desk — time-series and change-point analysis')
    d.header('Change points')
    d.label(40,146,'MERRA-2 / AIR TEMPERATURE / GRID CELL 46.5° N 32.5° E')
    d.text(40,217,'Read the signal. Question the break.',48,weight=700,spacing=-1)
    d.button(40,248,162,'Observations')
    d.button(212,248,228,'Monthly differences',True)
    d.chart(40,351,944,304,change=True)
    d.line(1016,248,1016,944)
    d.label(1050,285,'CHANGE POINT / ILLUSTRATIVE')
    d.text(1050,349,'2014',64,weight=700)
    d.lines(1050,399,['Possible abrupt change.', 'A candidate is not a cause.'],18,27)
    for yy,left,right in [(485,'Timing','Abrupt'),(530,'Persistence','Needs assessment'),(575,'Spatial extent','Not assessed')]:
        d.label(1050,yy,left)
        d.text(1050,yy+24,right,17)
    d.line(1050,637,1400,637)
    d.label(1050,677,'EONET CONTEXT')
    d.lines(1050,716,['No matching record found.', 'The catalogue is incomplete.', 'Origin remains undetermined.'],16,27)
    d.label(40,724,'TIME APERTURE / MOVE BOTH ENDS OF THE QUESTION')
    d.line(86,771,950,771,d.t['muted'],2)
    d.line(86,753,86,789,d.t['orange'],4)
    d.line(950,753,950,789,d.t['orange'],4)
    d.text(86,817,'2000',16,mono=True)
    d.text(950,817,'2025',16,mono=True,anchor='end')
    d.line(40,852,984,852)
    d.label(40,889,'DIRECTION')
    d.text(40,927,'Increasing',28,weight=700)
    d.label(365,889,'SLOPE / ILLUSTRATIVE')
    d.text(365,927,'+0.4 °C / decade',28,weight=700)
    d.label(720,889,'95% SLOPE CI / °C PER DECADE')
    d.text(720,927,'+0.2 to +0.6',25)
    d.footer('Illustrative candidate and trend · a product boundary is marked separately when one exists.')
    d.save(name,'analysis')


def journal():
    name='evidence-journal'
    d=Drawing(name,'Evidence Journal — main selection spread')
    d.header()
    d.label(48,148,'A WORKSPACE FOR EARTH OBSERVATIONS')
    d.lines(48,221,['Start with', 'a question.'],66,68,serif=True)
    d.text(48,340,'Seven views of a changing Earth.',19)
    d.text(48,400,'01',14,mono=True)
    d.field(100,395,444,'What would you like to measure?','Air temperature · MERRA-2')
    d.text(48,511,'02',14,mono=True)
    d.label(100,507,'WHERE?')
    d.button(100,527,164,'Point',True)
    d.button(274,527,164,'Area')
    d.text(100,609,'46.5° N / 32.5° E',20,serif=True)
    d.text(48,679,'03',14,mono=True)
    d.field(100,674,444,'Over which period?','2000 — 2025')
    d.button(100,778,312,'Read the time series  →',True,h=52)
    d.lines(100,867,['Live analysis works outside this map.', 'The map layer covers Europe first.'],14,23,color=d.t['muted'])
    d.line(602,142,602,932,d.t['ink'])
    d.map(641,172,751,562)
    d.label(641,785,'THE SAME VARIABLE / TWO DIRECTIONS')
    d.legend(641,815)
    d.lines(641,899,['Colour shows direction and rate; hatching shows statistical support.', 'Map and time-series source, product and period are always named.'],14,23,color=d.t['muted'])
    d.footer('Illustrative data · direction names describe design studies, not the final product name.')
    d.save(name,'main')

    d=Drawing(name,'Evidence Journal — time-series evidence and context spread')
    d.header('Change points')
    d.label(48,147,'AIR TEMPERATURE / MERRA-2 / 46.5° N 32.5° E')
    d.lines(48,213,['The record', 'and its limits.'],54,56,serif=True)
    d.text(750,194,'2000 — 2025',24,serif=True)
    d.lines(750,226,['Increasing · +0.4 °C / decade', 'Illustrative result, not an observation.'],17,25)
    d.text(750,283,'95% slope CI: +0.2 to +0.6 °C / decade',14)
    d.button(48,309,160,'Observations')
    d.button(218,309,228,'Monthly differences',True)
    px,py,pw,ph=d.chart(48,406,932,302,change=True)
    d.line(px+pw*.57,py-16,1016,py-16,d.t['ink'])
    d.circle(1016,py-16,4,d.t['ink'])
    d.line(1016,309,1016,936,d.t['ink'],1.5)
    d.label(1050,340,'THE EVIDENCE HINGE')
    d.text(1050,387,'A possible change',27,serif=True)
    d.text(1050,420,'2014 · illustrative candidate',14,d.t['muted'])
    d.label(1050,476,'WHAT WAS OBSERVED')
    d.lines(1050,512,['A change in the series.', 'Spatial extent: not assessed.', 'Cause: not determined.'],16,26)
    d.label(1050,638,'ALTERNATIVES TO CONSIDER')
    d.lines(1050,674,['Natural variability.', 'Changes in observations.', 'External events need sources.'],16,26)
    d.line(48,764,980,764,d.t['ink'])
    d.label(48,802,'OBSERVATION IS NOT ATTRIBUTION')
    d.lines(48,846,['A break and a gradual trend can coexist.', 'Inspect timing, uncertainty and product boundaries before interpreting why.'],20,31,serif=True)
    d.label(1050,827,'EONET / CONTEXT ONLY')
    d.lines(1050,864,['No matching record found.', 'The catalogue is incomplete.'],15,24)
    d.footer('Illustrative evidence spread · metadata and source limitations stay attached to the result.')
    d.save(name,'analysis')


def interactions():
    for theme in THEMES:
        d=Drawing(theme,THEMES[theme]['label']+' — signature interaction storyboard',height=570)
        titles={
            'field-atlas':('The coordinate thread.', [('01 / CHOOSE','Select a real point or area.'),('02 / ANCHOR','Keep place, product and period attached.'),('03 / READ','Open the corresponding series.')]),
            'signal-desk':('The time aperture.', [('01 / FRAME','Choose start and end dates.'),('02 / REQUEST','Confirm the period; wait for the result.'),('03 / COMPARE','Read the returned evidence, not a preview.')]),
            'evidence-journal':('The evidence hinge.', [('01 / LOCATE','Select a detected change candidate.'),('02 / OPEN','Link its date to the evidence column.'),('03 / INTERPRET','Read observations, alternatives and limits.')]),
        }
        title,steps=titles[theme]
        d.text(40,112,title,40,serif=theme!='signal-desk',weight=700 if theme=='signal-desk' else 400)
        for i,(label,caption) in enumerate(steps):
            x=40+i*472
            d.label(x,167,label)
            d.line(x,187,x+414,187)
            if theme=='field-atlas':
                if i<2:
                    for row in range(3):
                        for col in range(7):
                            d.rect(x+32+col*40,217+row*32,38,30,d.t[['blue','softblue','pale','softorange','orange'][(row+col)%5]])
                    d.circle(x+151,263,12,d.t['bg'],d.t['ink'],2)
                else:
                    d.label(x+18,226,'OBSERVATIONS')
                    d.add(f'<polyline points="{x+18},310 {x+68},287 {x+108},302 {x+151},273 {x+198},285 {x+246},251 {x+294},261 {x+342},236" fill="none" stroke="{d.t["blue"]}" stroke-width="2"/>')
                    d.circle(x+151,273,5,d.t['bg'],d.t['ink'],2)
                if i>0:
                    d.line(x+151,275,x+151,358,d.t['ink'],2)
                    d.line(x+18,358,x+396,358,d.t['ink'])
                    d.circle(x+151,358,4,d.t['ink'])
                    d.text(x+18,390,'PLACE / PRODUCT / PERIOD',13,mono=True)
            elif theme=='signal-desk':
                d.line(x+26,290,x+388,290,d.t['rule'],2)
                lx,rx=(x+26,x+388) if i==0 else (x+98,x+348)
                d.line(lx,262,lx,317,d.t['orange'],4)
                d.line(rx,262,rx,317,d.t['orange'],4)
                d.text(lx,348,'START',13,mono=True,anchor='middle')
                d.text(rx,348,'END',13,mono=True,anchor='middle')
                d.text(x+207,235,'MAP PERIOD STAYS FIXED',12,d.t['muted'],mono=True,anchor='middle')
                if i==1:d.text(x+207,390,'RETRIEVING · NO FAKE %',14,mono=True,anchor='middle')
                if i==2:d.text(x+207,390,'RESULT MATCHES THIS PERIOD',14,mono=True,anchor='middle')
            else:
                d.line(x+236,215,x+236,396,d.t['ink'],2)
                d.add(f'<polyline points="{x+15},340 {x+65},312 {x+100},325 {x+141},276 {x+185},286 {x+222},260" fill="none" stroke="{d.t["blue"]}" stroke-width="2"/>')
                d.line(x+141,240,x+141,370,d.t['ink'],1,'4 4')
                if i>0:
                    d.line(x+141,240,x+236,240,d.t['ink'])
                    d.circle(x+236,240,4,d.t['ink'])
                labels=[['SELECT A', 'CANDIDATE'],['OBSERVED', 'LOADING', 'EONET CONTEXT', 'PENDING'],['OBSERVED', 'ALTERNATIVES', 'EONET CONTEXT', 'LIMITATIONS']][i]
                d.lines(x+256,260,labels,12,35,mono=True)
            d.text(x,446,caption,14)
            if i<2:d.text(x+438,304,'→',23)
        d.footer('Storyboard only · keyboard alternatives and reduced-motion behaviour are specified in the design report.')
        d.save(theme,'interaction')


def states():
    d=Drawing('field-atlas','Shared state treatments — no fabricated observations',height=1110)
    d.text(48,116,'Honest states are part of the instrument.',40,serif=True)
    d.text(48,154,'Shared behaviour across all three directions. These are copy and composition studies.',17)
    entries=[
        ('01 / QUEUED', 'Your area request is queued.', ['Selected area and period stay visible.', 'Waiting for the source to start.'], 'No graph. No invented percentage.'),
        ('02 / RETRIEVING', 'Retrieving observations…', ['Area requests can take about 3 minutes, or longer.', 'MODIS histories can take much longer.'], 'Show real stage and elapsed time; estimate ≠ deadline.'),
        ('03 / NO DATA', 'No observations here.', ['This variable has no observations for the selected', 'place and period. Try another place or variable.'], 'A missing value is not zero.'),
        ('04 / SOURCE ERROR', 'The source could not finish.', ['Your selection is preserved. Retry this request.', 'A failure is not evidence of no observations.'], 'Retry without changing the question.'),
        ('05 / TEST UNAVAILABLE', 'The series is available. The test is not.', ['Show the actual observations, with gaps.', 'Explain the specific failed suitability condition.'], 'No p-value or slope is invented.'),
        ('06 / PRODUCT BOUNDARY', 'Interpret this boundary with care.', ['Mark the date on the available series.', 'Name products/versions; do not silently stitch them.'], 'A boundary is a warning, not a causal verdict.'),
    ]
    for i,(tag,title,body,note) in enumerate(entries):
        x=48+(i%2)*700
        y=216+(i//2)*234
        d.line(x,y,x+644,y,d.t['ink'])
        d.label(x,y+29,tag)
        d.text(x,y+69,title,23,serif=True)
        d.lines(x,y+103,body,15,24)
        d.text(x,y+177,note,13,d.t['muted'])
    d.line(48,934,1392,934,d.t['ink'])
    d.label(48,967,'CACHED OBSERVATIONS')
    d.text(48,1002,'Name the saved request and retrieval date. Never substitute a nearby place or another period.',17)
    d.footer('Additional independent states: EONET unavailable ≠ no record · no supported trend ≠ no change.')
    d.save('_shared','states')


if __name__ == '__main__':
    atlas()
    signal()
    journal()
    interactions()
    states()
    print('Built six screen SVGs, three storyboards and the shared state study. All analytical marks are illustrative.')
