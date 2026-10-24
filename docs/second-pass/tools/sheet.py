# usage: python3 sheet.py OUT.png cols cellw img1 img2 ...   (labels each cell with its filename)
import sys
from PIL import Image, ImageDraw
out, cols, cw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
ims = [Image.open(p).convert('RGB') for p in sys.argv[4:]]
ch = int(cw * ims[0].height / ims[0].width)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (cols * cw + (cols - 1) * 6, rows * (ch + 22)), (200, 200, 200))
d = ImageDraw.Draw(sheet)
for i, (im, p) in enumerate(zip(ims, sys.argv[4:])):
    x, y = (i % cols) * (cw + 6), (i // cols) * (ch + 22)
    sheet.paste(im.resize((cw, ch), Image.LANCZOS), (x, y + 22))
    d.text((x + 4, y + 4), p.split('/')[-1], fill=(0, 0, 0))
sheet.save(out)
