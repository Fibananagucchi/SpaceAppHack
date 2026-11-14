"""Task 006: presentation-only refinements, never a product data source.

All traces, trend colours, readouts and change dates are illustrative artwork.
No frontend, API, analysis, source requests, persistence or deployment is built.
"""

from pathlib import Path
import math
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from render_sketches import Drawing

DEST = 'signal-desk-v2'


def study(number, title, subtitle, cost, active='Time series'):
    d=Drawing('signal-desk',title,height=900)
    d.header(active)
    d.label(40,145,f'REFINEMENT {number} / SIGNAL DESK / PROPOSAL FOR TEAM REVIEW')
    d.text(1400,145,cost,13,d.t['muted'],mono=True,anchor='end')
    d.text(40,211,title,45,weight=700,spacing=-1)
    d.text(40,253,subtitle,17)
    d.line(40,287,1400,287)
    return d


def frame(d,x,label):
    d.label(x,326,label)
    d.line(x,345,x+412,345)


def mini_plot(d,x,y,w=386,h=190,window=False,old=False):
    ink=d.t['muted'] if old else d.t['blue']
    for frac in [0,.5,1]:
        d.line(x,y+h*frac,x+w,y+h*frac,d.t['rule'],.7)
    # Hand-authored drawing coordinates; not a numerical observation series.
    pts=[(.00,.82),(.06,.91),(.12,.62),(.18,.73),(.24,.50),(.30,.68),(.36,.54),(.42,.66),(.48,.39),(.54,.50),(.60,.29),(.66,.43),(.72,.30),(.78,.42),(.84,.18),(.90,.25),(.96,.10),(1,.20)]
    for a,b in [(0,8),(9,len(pts))]:
        line=' '.join(f'{x+px*w:.1f},{y+py*h:.1f}' for px,py in pts[a:b])
        d.add(f'<polyline points="{line}" fill="none" stroke="{ink}" stroke-width="2.5"/>')
    if window:
        left,right=x+w*.2,x+w*.8
        d.rect(x,y,w*.2,h,d.t['bg'],opacity=.7)
        d.rect(right,y,w*.2,h,d.t['bg'],opacity=.7)
    else:
        left,right=x,x+w
    for xx in [left,right]:
        d.line(xx,y-15,xx,y+h+10,d.t['orange'],3)
        d.line(xx,y-15,xx+(-10 if xx==right else 10),y-15,d.t['orange'],3)
        d.line(xx,y+h+10,xx+(-10 if xx==right else 10),y+h+10,d.t['orange'],3)
    d.text(left,y+h+40,'2005' if window else '2000',14,mono=True)
    d.text(right,y+h+40,'2020' if window else '2025',14,mono=True,anchor='end')
    d.text(x,y-34,'ILLUSTRATIVE OBSERVATIONS / GAPS PRESERVED',11,d.t['muted'],mono=True)


def aperture():
    d=study('01','Put the years around the evidence.','The time aperture belongs on the record itself, not in a separate control strip.','+1.5–2.5 H')
    for i,(label,caption) in enumerate([
        ('A / A RECORD IN VIEW','Frame the question with two dates.'),
        ('B / A DIFFERENT WINDOW','Keep the observations; request new statistics.'),
        ('C / A MATCHING RESULT','Reveal only the result for this window.')]):
        x=40+i*472
        frame(d,x,label)
        mini_plot(d,x+12,420,386,166,window=i>0,old=i==1)
        if i==0:
            d.text(x+12,680,'2000 — 2025',27,weight=700)
            d.text(x+12,718,'Current analysis period',15,d.t['muted'])
        elif i==1:
            d.text(x+12,680,'Recalculating this window…',24,weight=700)
            d.text(x+12,718,'New estimate is not available yet.',15,d.t['muted'])
        else:
            d.text(x+12,680,'+0.3 °C / decade',29,weight=700)
            d.text(x+12,718,'Illustrative returned slope · 2005–2020',14,d.t['muted'])
        d.text(x,769,caption,14)
        if i<2:d.text(x+440,508,'→',23)
    d.footer('Keyboard: two date fields · reduced motion: immediate state change · the prepared map keeps its own period.')
    d.save(DEST,'01-time-aperture')


def pin(d,x,y,label,color):
    d.circle(x,y,15,d.t['bg'],color,2)
    d.text(x,y+5,label,14,color,weight=700,anchor='middle')


def map_xy(x,y,w,h,lon,lat):
    merc=lambda a: math.log(math.tan(math.pi/4+math.radians(a)/2))
    scale=min(w/math.radians(60),h/(merc(72)-merc(33)))
    return x+w/2+math.radians(lon-15)*scale,y+h/2+((merc(72)+merc(33))/2-merc(lat))*scale


def counter_directions():
    d=study('02','One variable. Opposite directions.','Make a two-place reading of the same prepared layer visible, with signs as well as colour.','+2–3 H','Explore')
    d.map(40,321,810,390,uid='pair')
    ax,ay=map_xy(40,321,810,390,38,60)
    bx,by=map_xy(40,321,810,390,32.5,46.5)
    pin(d,ax,ay,'A',d.t['blue'])
    pin(d,bx,by,'B',d.t['orange'])
    d.line(888,321,888,773)
    d.label(920,343,'A / 60.0° N 38.0° E / ILLUSTRATIVE')
    d.text(920,410,'−',71,d.t['blue'],weight=700)
    d.text(1000,395,'Decreasing',29,weight=700)
    d.text(1000,433,'−0.2 °C / decade',23)
    d.line(920,471,1400,471)
    d.label(920,510,'B / 46.5° N 32.5° E / ILLUSTRATIVE')
    d.text(920,576,'+',71,d.t['orange'],weight=700)
    d.text(1000,561,'Increasing',29,weight=700)
    d.text(1000,599,'+0.4 °C / decade',23)
    d.label(920,674,'SAME PRODUCT / SAME MAP PERIOD')
    d.lines(920,711,['MERRA-2 · Jan 1980–Sep 2026', 'Map estimates, not the custom time window.'],15,25)
    d.legend(40,749)
    d.text(40,814,'Pin up to two available map cells. Never invent an opposite sign or replace the selected place.',14)
    d.footer('No second analysis endpoint · two map-cell readouts only · labels and +/− signs carry meaning without colour.')
    d.save(DEST,'02-counter-directions')


def seam():
    d=study('03','A possible change. A visible limit.','Attach the explanation to the candidate date; keep its cause an open question.','+1–1.5 H','Change points')
    px,py,pw,ph=d.chart(40,370,916,287,change=False)
    sx=px+pw*.57
    d.line(sx,py-17,sx,py+ph,d.t['ink'],2,'6 4')
    d.line(sx-13,py-17,sx+13,py-17,d.t['orange'],3)
    d.line(sx-13,py+ph,sx+13,py+ph,d.t['orange'],3)
    d.text(sx,py-33,'2014 · possible change',14,anchor='middle')
    d.line(sx,py+ph,sx,py+ph+7,d.t['orange'],1.5)
    d.line(sx,py+ph+7,972,py+ph+7,d.t['orange'],1.5)
    d.line(972,py+ph+7,972,412,d.t['orange'],1.5)
    d.line(972,412,1010,412,d.t['orange'],1.5)
    d.line(991,322,991,795)
    d.circle(991,412,4,d.t['orange'])
    d.label(1024,344,'ILLUSTRATIVE CANDIDATE')
    d.text(1024,412,'2014',60,weight=700)
    d.text(1024,457,'A shift in the record.',24,weight=700)
    d.lines(1024,493,['Method: Pettitt on monthly differences.', 'Spatial extent: not assessed.', 'Persistence: not assessed.'],15,25)
    d.line(1024,582,1400,582)
    d.label(1024,620,'EONET / CONTEXT ONLY')
    d.lines(1024,659,['No matching record found.', 'The catalogue is incomplete.', 'Cause remains undetermined.'],16,27)
    d.text(40,741,'Observe the change.',32,weight=700)
    d.text(40,783,'Do not turn a date into a cause.',23,d.t['muted'])
    d.footer('No candidate: no seam · a documented product boundary gets its own labelled marker · no points are removed.')
    d.save(DEST,'03-change-seam')


def waiting():
    d=study('04','Waiting should keep your place.','A quiet request rail communicates real state, not imaginary measurements or a fake countdown.','+0.75–1.25 H','Explore')
    labels=['CONNECTING','WAITING FOR SOURCE','SOURCE UNAVAILABLE']
    for i,label in enumerate(labels):
        x=40+i*472
        frame(d,x,f'STATE {i+1} / {label}')
        d.label(x,393,'AREA / 25–35° E / 44–52° N')
        d.text(x,432,'2000 — 2025',24,mono=True)
        d.line(x,492,x+412,492,d.t['rule'],2)
        # Static positions in a motion storyboard. Not a percentage or source progress.
        if i<2:
            ox=x+(68 if i==0 else 206)
            d.line(ox,480,ox,504,d.t['orange'],3)
            d.line(ox+20,480,ox+20,504,d.t['orange'],3)
        else:
            d.line(x+192,483,x+210,501,d.t['orange'],2)
            d.line(x+210,483,x+192,501,d.t['orange'],2)
        if i==0:
            d.lines(x,559,['Connecting to the', 'analysis service…'],25,34,weight=700)
            d.lines(x,651,['Your selection stays here.', 'No observations returned yet.'],16,27)
        elif i==1:
            d.lines(x,559,['Waiting for', 'observations…'],25,34,weight=700)
            d.lines(x,651,['Elapsed 01:12 · illustrative timer', 'Progress is not reported by the source.'],15,27)
        else:
            d.lines(x,559,['The source could not', 'complete this request.'],25,34,weight=700)
            d.button(x,636,166,'Retry request')
            d.text(x,713,'No observations have been substituted.',14,d.t['muted'])
    d.text(40,796,'These are alternative states, not an automatic sequence. The rail never draws a pretend chart.',14)
    d.footer('Motion is optional: an indeterminate bracket moves; reduced motion keeps it still · real stages come from the API.')
    d.save(DEST,'04-request-rail')


def voice():
    d=study('05','Let the instrument speak precisely.','Replace a generic dashboard slogan with the variable, the finding and the limit of that finding.','+0.5–1 H')
    for i,label in enumerate(['ENTRY / MEASUREMENT','RESULT / RATE AND SUPPORT','NO DATA / KEEP THE QUESTION']):
        frame(d,40+i*472,label)
    d.label(40,398,'MERRA-2 / REANALYSIS')
    d.lines(40,464,['AIR', 'TEMPERATURE'],43,51,weight=700,spacing=-1)
    d.text(40,578,'AT 2 M',27,weight=700)
    d.lines(40,650,['How has it changed here?', 'Choose a place. Set the years.'],20,31)
    d.label(512,398,'ILLUSTRATIVE ANALYSIS')
    d.text(512,464,'Increasing.',41,weight=700)
    d.text(512,525,'+0.4',65,weight=700)
    d.text(512,563,'°C / decade',23)
    d.lines(512,630,['95% slope CI: +0.2 to +0.6', 'Support under the test assumptions.', 'A trend does not establish its cause.'],16,28)
    d.label(984,398,'NO VALUES RETURNED')
    d.lines(984,464,['No observations.', 'Your question', 'stays.'],33,45,weight=700)
    d.lines(984,651,['Try another place, period or variable.', 'A blank record is not a zero.'],16,28)
    d.text(40,791,'No new data or endpoint. The same vocabulary carries through entry, result, error and uncertainty.',14)
    d.footer('Long variable names wrap; the source/model distinction stays visible · no verdict stamp, score or confidence badge.')
    d.save(DEST,'05-voice')


def recommended():
    d=Drawing('signal-desk','Signal Desk — proposed combination of refinements 01 and 03',height=1040)
    d.header('Change points')
    d.label(40,144,'PROPOSED COMBINATION / OPTIONS 01 + 03 / TEAM CHOICE PENDING')
    d.text(40,211,'Frame the years. Read the change.',49,weight=700,spacing=-1)
    d.text(40,253,'Air temperature at 2 m · MERRA-2 · cell 46.5° N 32.5° E',17)
    d.button(40,285,160,'Observations')
    d.button(210,285,228,'Monthly differences',True)
    d.text(470,313,'Monthly baseline: 2000–2025',14,d.t['muted'])
    d.label(40,373,'ANALYSIS WINDOW / ILLUSTRATIVE')
    d.text(88,429,'2000',41,weight=700)
    d.text(930,429,'2025',41,weight=700,anchor='end')
    px,py,pw,ph=d.chart(40,487,922,259,change=False)
    for xx in [px,px+pw]:
        d.line(xx,py-2,xx,py+ph+10,d.t['orange'],3)
        d.line(xx,py-2,xx+(12 if xx==px else -12),py-2,d.t['orange'],3)
        d.line(xx,py+ph+10,xx+(12 if xx==px else -12),py+ph+10,d.t['orange'],3)
    sx=px+pw*.57
    d.line(sx,py-20,sx,py+ph,d.t['ink'],2,'6 4')
    d.text(sx,py-36,'2014 · possible change',14,anchor='middle')
    d.line(sx,py+ph,sx,py+ph+7,d.t['orange'],1.5)
    d.line(sx,py+ph+7,985,py+ph+7,d.t['orange'],1.5)
    d.line(985,py+ph+7,985,437,d.t['orange'],1.5)
    d.line(985,437,1023,437,d.t['orange'],1.5)
    d.line(1004,349,1004,942)
    d.circle(1004,437,4,d.t['orange'])
    d.label(1038,373,'ILLUSTRATIVE CHANGE CANDIDATE')
    d.text(1038,437,'2014',61,weight=700)
    d.text(1038,485,'A shift in the record.',23,weight=700)
    d.lines(1038,524,['Spatial extent: not assessed.', 'Persistence: not assessed.'],16,27)
    d.line(1038,603,1400,603)
    d.label(1038,644,'EONET / SEPARATE CONTEXT')
    d.lines(1038,685,['No matching record found.', 'The catalogue is incomplete.'],16,27)
    d.text(1038,785,'Cause undetermined.',23,weight=700)
    d.line(40,805,962,805)
    d.label(40,847,'SLOPE / ILLUSTRATIVE')
    d.text(40,894,'+0.4 °C / decade',30,weight=700)
    d.label(514,847,'95% SLOPE CI / °C PER DECADE')
    d.text(514,894,'+0.2 to +0.6',30)
    d.button(40,922,224,'Methods & source details')
    d.text(296,948,'Only the selected period is analysed. Its cause is a separate question.',14,d.t['muted'])
    d.footer('Illustrative design combination only · no working chart controls, request logic or statistics are implemented.')
    d.save(DEST,'recommended-01-03')


if __name__=='__main__':
    aperture()
    counter_directions()
    seam()
    waiting()
    voice()
    recommended()
    print('Built five refinement studies and one proposed combined screen; all analytical artwork is illustrative.')
