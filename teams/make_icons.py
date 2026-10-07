"""Generate Teams app icons (pure stdlib — no PIL).
Clock motif (attendance) on a dark-navy gradient rounded square.
  color.png  192x192 (filled)
  outline.png 32x32  (transparent bg, white clock)
"""
import struct, zlib, math, os

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

def feather(d, inner, outer):
    """1 inside `inner`, 0 outside `outer`, linear between."""
    if d <= inner: return 1.0
    if d >= outer: return 0.0
    return (outer - d) / (outer - inner)

def rounded_rect(x, y, w, h, r):
    """True if (x,y) is inside a rounded rect centered in a w x h canvas."""
    # corners as quarter circles
    cx = min(max(x, r), w - 1 - r)
    cy = min(max(y, r), h - 1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def dist_seg(px_, py_, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L2 = dx * dx + dy * dy
    if L2 == 0: return math.hypot(px_ - x1, py_ - y1)
    t = clamp(((px_ - x1) * dx + (py_ - y1) * dy) / L2, 0, 1)
    return math.hypot(px_ - (x1 + t * dx), py_ - (y1 + t * dy))

def band(d, r_in, r_out, f=1.0):
    """1 inside [r_in, r_out], feather f px at each edge."""
    a1 = clamp((d - (r_in - f)) / f, 0.0, 1.0)
    a2 = 1.0 - clamp((d - (r_out - f)) / f, 0.0, 1.0)
    return min(a1, a2)

def clock_pixels(x, y, S, ro, rt, hands, hub):
    """Alpha of the white clock glyph at pixel (x,y) on an S-canvas.
    ro/ring outer radius, rt/ring thickness; hands=(angle_deg, length) at 12 o'clock=90."""
    cx = cy = S / 2 - 0.5
    d = math.hypot(x - cx, y - cy)
    a = band(d, ro - rt, ro, f=max(0.7, S * 0.012))          # ring stroke
    hw = S * 0.028                                            # hand half-thickness
    for ang, ln in hands:
        rad = math.radians(ang)
        ex, ey = cx + ln * math.cos(rad), cy - ln * math.sin(rad)
        a = max(a, feather(dist_seg(x, y, cx, cy, ex, ey), 0.0, hw))
    a = max(a, feather(d, 0.0, hub))                              # hub dot
    return a

def make_icon(path, S, outline=False):
    px = [[(0, 0, 0, 0)] * S for _ in range(S)]
    r_corner = int(S * 0.20)
    top = (27, 42, 84)     # #1b2a54
    bot = (13, 22, 48)     # #0d1630
    for y in range(S):
        for x in range(S):
            if not rounded_rect(x, y, S, S, r_corner):
                continue
            t = y / max(1, S - 1)
            bg = (int(top[0] + (bot[0] - top[0]) * t),
                  int(top[1] + (bot[1] - top[1]) * t),
                  int(top[2] + (bot[2] - top[2]) * t), 255)
            a = clock_pixels(x, y, S,
                             ro=S * 0.335, rt=S * 0.062,
                             hands=[(150, S * 0.26), (60, S * 0.30)],
                             hub=S * 0.045)
            if outline:
                col = (255, 255, 255, int(255 * a))
            else:
                w = int(255 * a)
                col = (int(bg[0] + (255 - bg[0]) * w / 255),
                       int(bg[1] + (255 - bg[1]) * w / 255),
                       int(bg[2] + (255 - bg[2]) * w / 255), 255)
            px[y][x] = col
    write_png(path, S, S, px)
    print(path, os.path.getsize(path), "bytes")

if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    make_icon(os.path.join(here, "color.png"), 192, outline=False)
    make_icon(os.path.join(here, "outline.png"), 32, outline=True)
