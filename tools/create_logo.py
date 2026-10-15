"""Render the WallBoard English logo as a transparent PNG using Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'design'
OUT.mkdir(exist_ok=True)
SCALE = 3
SIZE = 1024
img = Image.new('RGBA', (SIZE * SCALE, SIZE * SCALE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
def box(values): return tuple(int(v * SCALE) for v in values)
def poly(points, color): d.polygon([(int(x*SCALE),int(y*SCALE)) for x,y in points],fill=color)
def line(points, color, width): d.line([(int(x*SCALE),int(y*SCALE)) for x,y in points], fill=color,width=int(width*SCALE),joint='curve')
forest = '#173F35'
mint = '#73D9AD'
paper = '#FFF8E7'
d.rounded_rectangle(box((48,48,976,976)),radius=220*SCALE,fill=forest)
# Two folded pages form a W; the lifted right page doubles as speech.
poly([(217,365),(339,393),(512,471),(512,760),(334,677),(217,652)], paper)
poly([(512,471),(684,393),(804,365),(804,652),(686,677),(512,760)], mint)
# A dark spine gives the pages breathing room and makes the W legible.
line([(512,476),(512,752)],forest,18)
# Three ascending sound bars above the book.
for x, top, bottom in [(430,272,328),(494,230,328),(558,188,328)]:
    d.rounded_rectangle(box((x,top,x+30,bottom)),radius=15*SCALE,fill=mint)
# Short editorial lines on the pages.
line([(268,456),(365,485),(425,514)],forest,16)
line([(268,516),(365,545),(425,574)],forest,16)
line([(593,514),(655,485),(752,456)],forest,16)
line([(593,574),(655,545),(752,516)],forest,16)
img = img.resize((SIZE,SIZE),Image.Resampling.LANCZOS)
img.save(OUT/'wallboard-english-logo.png')
img.resize((512,512),Image.Resampling.LANCZOS).save(OUT/'wallboard-english-logo-512.png')
print('Created logo PNG files in design/')
