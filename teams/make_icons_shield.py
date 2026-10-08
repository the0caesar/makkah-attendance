"""Generate Teams app icons for Protection Portal (pure stdlib — no PIL).
Shield motif with 'PMK' wordmark on a dark-navy rounded square.
  color.png    192x192 (filled, transparent outside the rounded square)
  outline.png   32x32  (transparent bg, white shield silhouette)
Shield geometry is defined once at 192 scale and scaled down for the outline.
"""
import struct, zlib, math, os

# ---------- PNG writer ----------
def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + b"".join(struct.pack("4B", *p) for p in row) for row in px)
    def chunk(t, d):
        c = t + d
        return struct.pack(">I", len(d)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def clamp(v, lo, hi): return max(lo, min(hi, v))

# ---------- geometry at 192 scale ----------
SH = {  # shield
    "x0": 52.0, "x1": 140.0, "y0": 44.0, "y1": 150.0,   # bbox
    "rc": 12.0,                                          # top corner radius
    "ys": 97.0,                                          # side straight-down to here
    "by": 138.0,                                         # bezier control y
}
def shield_poly(res=24):
    """Clockwise outline: top edge, TR corner, right side, right bezier to tip,
    left bezier, left side, TL corner."""
    x0, x1, y0, y1, rc, ys, by = (SH[k] for k in ("x0","x1","y0","y1","rc","ys","by"))
    cx = (x0 + x1) / 2
    pts = []
    pts += [(x0 + rc + i * (x1 - x0 - 2 * rc) / 16, y0) for i in range(17)]
    crx, cry = x1 - rc, y0 + rc
    for i in range(0, res + 1):
        a = math.radians(-90 + 90 * i / res)
        pts.append((crx + rc * math.cos(a), cry + rc * math.sin(a)))
    pts += [(x1, ys)]
    for i in range(1, res + 1):
        t = i / res
        u = 1 - t
        pts.append((u*u*x1 + 2*u*t*x1 + t*t*cx, u*u*ys + 2*u*t*by + t*t*y1))
    for i in range(1, res):
        t = i / res
        u = 1 - t
        pts.append((u*u*cx + 2*u*t*x0 + t*t*x0, u*u*y1 + 2*u*t*by + t*t*ys))
    pts += [(x0, ys), (x0, y0 + rc)]
    clx, cly = x0 + rc, y0 + rc
    for i in range(0, res + 1):
        a = math.radians(180 + 90 * i / res)
        pts.append((clx + rc * math.cos(a), cly + rc * math.sin(a)))
    return pts

POLY192 = shield_poly()

def _pip(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x2, y2 = poly[(i + 1) % n]
        x1, y1 = poly[i]
        if (y1 > y) != (y2 > y):
            xt = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if x < xt:
                inside = not inside
    return inside

def _dist_edges(x, y, poly):
    n = len(poly)
    best = 1e9
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        dx, dy = x2 - x1, y2 - y1
        L2 = dx*dx + dy*dy
        if L2 == 0:
            d = math.hypot(x - x1, y - y1)
        else:
            t = clamp(((x - x1)*dx + (y - y1)*dy) / L2, 0.0, 1.0)
            d = math.hypot(x - (x1 + t*dx), y - (y1 + t*dy))
        if d < best:
            best = d
    return best

# ---------- 'PMK' strokes (192 scale, centered on shield) ----------
T = 7.5  # stroke thickness
def _seg_list():
    segs = []
    yT, yB = 74.0, 103.0
    # P: x 56..76
    segs.append((59.0, yT, 59.0, yB))                      # stem
    bx, byc, r = 60.0, 84.5, 10.8                          # bowl (right half circle)
    prev = None
    for i in range(13):
        a = math.radians(-82 + 164 * i / 12)
        p = (bx + r * math.cos(a), byc + r * math.sin(a))
        if prev: segs.append((prev[0], prev[1], p[0], p[1]))
        prev = p
    # M: x 86..106
    mx1, mx2, mxm = 88.0, 104.0, 96.0
    segs.append((mx1, yT, mx1, yB))                        # left stem
    segs.append((mx2, yT, mx2, yB))                        # right stem
    segs.append((mx1, yT, mxm, 92.0))                      # left diagonal
    segs.append((mx2, yT, mxm, 92.0))                      # right diagonal
    # K: x 116..136
    kx, ktop, kbot, km = 118.0, 74.0, 103.0, 90.0
    segs.append((kx, ktop, kx, kbot))                      # stem
    segs.append((kx + 16.0, ktop, kx, km))                 # upper diagonal
    segs.append((kx, km, kx + 16.0, kbot))                 # lower diagonal
    return segs

SEG192 = _seg_list()

def _dist_segs(x, y, segs):
    best = 1e9
    for x1, y1, x2, y2 in segs:
        dx, dy = x2 - x1, y2 - y1
        L2 = dx*dx + dy*dy
        if L2 == 0:
            d = math.hypot(x - x1, y - y1)
        else:
            t = clamp(((x - x1)*dx + (y - y1)*dy) / L2, 0.0, 1.0)
            d = math.hypot(x - (x1 + t*dx), y - (y1 + t*dy))
        if d < best:
            best = d
    return best

def rounded_rect(x, y, w, h, r):
    cx = min(max(x, r), w - 1 - r)
    cy = min(max(y, r), h - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def aa(signed_dist, w=1.0):
    """1 inside, 0 outside, linear across +-w/2."""
    return clamp(0.5 - signed_dist / w, 0.0, 1.0)

# ---------- icons ----------
def make_color(path, S=192):
    top = (27, 42, 84)      # #1b2a54
    bot = (13, 22, 48)      # #0d1630
    shield_blue = (76, 194, 255)   # #4cc2ff (app accent)
    navy = (13, 22, 48)
    r_corner = int(S * 0.20)
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    for y in range(S):
        for x in range(S):
            if not rounded_rect(x + 0.5, y + 0.5, S, S, r_corner):
                continue
            t = y / max(1, S - 1)
            bg = (int(top[0] + (bot[0] - top[0]) * t),
                  int(top[1] + (bot[1] - top[1]) * t),
                  int(top[2] + (bot[2] - top[2]) * t))
            d = _dist_edges(x + 0.5, y + 0.5, POLY192)
            ins = _pip(x + 0.5, y + 0.5, POLY192)
            sd = -d if ins else d
            a_sh = aa(sd, 1.6)
            col = bg
            if a_sh > 0:
                col = tuple(int(col[i] + (shield_blue[i] - col[i]) * a_sh) for i in range(3))
            if a_sh > 0.5:
                dt = _dist_segs(x + 0.5, y + 0.5, SEG192)
                a_tx = aa(dt - T / 2 + 0.6, 1.4)
                if a_tx > 0:
                    a_tx *= a_sh
                    col = tuple(int(col[i] + (navy[i] - col[i]) * a_tx) for i in range(3))
            px[y][x] = (col[0], col[1], col[2], 255)
    write_png(path, S, S, px)
    print(path, os.path.getsize(path), "bytes")

def make_outline(path, S=32):
    sc = S / 192.0
    poly = [(x * sc, y * sc) for (x, y) in POLY192]
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    for y in range(S):
        for x in range(S):
            d = _dist_edges(x + 0.5, y + 0.5, poly)
            ins = _pip(x + 0.5, y + 0.5, poly)
            sd = -d if ins else d
            a = aa(sd, S / 16.0)
            px[y][x] = (255, 255, 255, int(255 * a))
    write_png(path, S, S, px)
    print(path, os.path.getsize(path), "bytes")

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    make_color(os.path.join(here, "color.png"), 192)
    make_outline(os.path.join(here, "outline.png"), 32)
