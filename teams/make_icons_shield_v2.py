"""Protection Portal icons — shield + PMK (Arial Black), 4x supersampled via Pillow.
  color.png    192x192  navy rounded square, gradient shield w/ soft shadow + rim, navy PMK
  outline.png   32x32   white shield silhouette on transparent
Run with the Hermes venv python (has Pillow):
  "C:/Users/Essam Omar/AppData/Local/hermes/hermes-agent/venv/Scripts/python.exe" make_icons_shield_v2.py
"""
import math, os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "C:/Windows/Fonts/ariblk.ttf"   # Arial Black
S = 192
SUP = 4                                  # supersample factor
B = S * SUP                              # big canvas (768)

# ---- shield geometry at 192 scale (v2: big + confident) ----
X0, X1, Y0, Y1 = 27.0, 165.0, 18.0, 175.0
RC = 11.0                                # top corner radius (sharp crest)
YS = 96.0                                # straight-side end
BY = 147.5                               # bezier control y
CX = (X0 + X1) / 2

def shield_poly(scale=1.0, res=48):
    pts = []
    w = X1 - X0 - 2 * RC
    pts += [(X0 + RC + i * w / 24, Y0) for i in range(25)]          # top edge
    for i in range(res + 1):                                        # TR corner
        a = math.radians(-90 + 90 * i / res)
        pts.append((X1 - RC + RC * math.cos(a), Y0 + RC + RC * math.sin(a)))
    pts.append((X1, YS))
    for i in range(1, res + 1):                                     # right bezier -> tip
        t, u = i / res, 1 - i / res
        pts.append((u*u*X1 + 2*u*t*X1 + t*t*CX, u*u*YS + 2*u*t*BY + t*t*Y1))
    for i in range(1, res):                                         # left bezier
        t, u = i / res, 1 - i / res
        pts.append((u*u*CX + 2*u*t*X0 + t*t*X0, u*u*Y1 + 2*u*t*BY + t*t*YS))
    pts += [(X0, YS), (X0, Y0 + RC)]
    for i in range(res + 1):                                        # TL corner
        a = math.radians(180 + 90 * i / res)
        pts.append((X0 + RC + RC * math.cos(a), Y0 + RC + RC * math.sin(a)))
    return [(x * scale, y * scale) for (x, y) in pts]

POLY = shield_poly(SUP)

def vgrad(w, h, top, bot):
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        d.line([(0, y), (w, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return img

def make_color():
    # 1) background: near-flat navy rounded square (subtle gradient, no banding)
    bg = vgrad(B, B, (24, 38, 78), (15, 24, 52))
    r = int(B * 0.20)
    mask = Image.new("L", (B, B), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, B - 1, B - 1], radius=r, fill=255)
    canvas = Image.new("RGBA", (B, B), (0, 0, 0, 0))
    canvas.paste(bg, (0, 0), mask)

    # 2) tight drop shadow (small offset, little blur, deliberate)
    sh = Image.new("RGBA", (B, B), (0, 0, 0, 0))
    ImageDraw.Draw(sh).polygon(POLY, fill=(0, 0, 0, 130))
    sh = sh.transform((B, B), Image.AFFINE, (1, 0, 0, 0, 1, -10))   # shift down 10px
    sh = sh.filter(ImageFilter.GaussianBlur(8))
    canvas = Image.alpha_composite(canvas, sh)

    # 3) shield fill: flatter, more confident blue gradient clipped to polygon
    grad = vgrad(B, B, (96, 190, 250), (58, 150, 225))
    smask = Image.new("L", (B, B), 0)
    ImageDraw.Draw(smask).polygon(POLY, fill=255)
    shield = Image.new("RGBA", (B, B), (0, 0, 0, 0))
    shield.paste(grad, (0, 0), smask)
    canvas = Image.alpha_composite(canvas, shield)

    # 4) crisp light edge (clipped to shield) so the silhouette separates from tile
    rim = Image.new("RGBA", (B, B), (0, 0, 0, 0))
    ImageDraw.Draw(rim).polygon(POLY, outline=(159, 224, 255, 255), width=int(3 * SUP))
    rim.putalpha(Image.composite(rim.getchannel("A"), Image.new("L", (B, B), 0), smask))
    canvas = Image.alpha_composite(canvas, rim)

    # 5) PMK — Arial Black, navy, big (80% of shield width), optical center
    d = ImageDraw.Draw(canvas)
    target_w = int((X1 - X0) * SUP * 0.90)
    size = 400
    while size > 40:
        f = ImageFont.truetype(FONT, size)
        bb = f.getbbox("PMK")
        if bb[2] - bb[0] <= target_w:
            break
        size -= 4
    f = ImageFont.truetype(FONT, size)
    bb = f.getbbox("PMK")
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    x = CX * SUP - tw / 2 - bb[0]
    y = (Y0 + 0.45 * (Y1 - Y0)) * SUP - th / 2 - bb[1]
    d.text((x, y), "PMK", font=f, fill=(13, 22, 48, 255))

    out = canvas.resize((S, S), Image.LANCZOS)
    p = os.path.join(HERE, "color.png")
    out.save(p)
    print(p, os.path.getsize(p), "bytes")

def make_outline():
    out = 32
    b = out * SUP                       # 128 canvas
    poly = shield_poly(out / 192.0 * SUP)
    img = Image.new("RGBA", (b, b), (0, 0, 0, 0))
    ImageDraw.Draw(img).polygon(poly, fill=(255, 255, 255, 255))
    p = os.path.join(HERE, "outline.png")
    img.resize((out, out), Image.LANCZOS).save(p)
    print(p, os.path.getsize(p), "bytes")

if __name__ == "__main__":
    make_color()
    make_outline()
