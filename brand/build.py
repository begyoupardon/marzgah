"""Generates Marzgah concept SVGs. Run: python3 brand/build.py"""
import math, re, subprocess, pathlib
OUT = pathlib.Path(__file__).parent / "concepts"
ARAD = "/Users/circle/Library/Fonts/AradVF.ttf"
VAZ = "/Users/circle/Library/Fonts/Vazirmatn-ExtraBold.ttf"

def f(n): return f"{n:.2f}".rstrip("0").rstrip(".")

def svg(body, w=256, h=256, fill="#000"):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w)}" height="{f(h)}"><g fill="{fill}">{body}</g></svg>\n'

# ---------- text → flattened path group via hb-view ----------
def text_group(text, font, size, wght=None, spacing=None):
    args = ["hb-view", font, text, "--output-format=svg", f"--font-size={size}", "--margin=0", "--ink", "-o", "/dev/stdout"]
    if wght: args.append(f"--variations=wght={wght}")
    s = subprocess.run(args, capture_output=True, text=True).stdout
    w, h = map(float, re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', s).groups())
    glyphs = dict(re.findall(r'<g id="(glyph-[\d-]+)">\s*<path d="([^"]*)"', s))
    out = []
    for gid, x, y in re.findall(r'<use xlink:href="#(glyph-[\d-]+)" x="([-\d.]+)" y="([-\d.]+)"', s):
        if glyphs.get(gid):
            out.append(f'<path transform="translate({x} {y})" d="{glyphs[gid]}"/>')
    return "".join(out), w, h

# ---------- A: iwan gate on a border line ----------
def iwan(gate_only=False, frame=True):
    X0, X1, Y0, Y1 = 52, 204, 44, 206          # pishtaq block
    sx0, sx1, spring = 88, 168, 124            # arch span & springing line
    d = 14; r = (sx1 - sx0) / 2 + d            # two-centred pointed arch
    cx = (sx0 + sx1) / 2; apex = spring - math.sqrt(r*r - d*d)
    foot = Y1 + (0 if gate_only else 18)          # doorway cuts through the border line
    arch = (f"M{sx0} {foot} V{spring} A{f(r)} {f(r)} 0 0 1 {f(cx)} {f(apex)} "
            f"A{f(r)} {f(r)} 0 0 1 {sx1} {spring} V{foot} Z")
    block = f"M{X0} {Y0} H{X1} V{Y1} H{X0} Z"
    if not gate_only:   # border line the gate sits in, broken only at the doorway
        block = f"M{X0} {Y0} H{X1} V{Y1} H236 V{Y1+18} H20 V{Y1} H{X0} Z"
    holes = arch
    if frame:           # pishtaq frame channel around the arch
        i, t = 16, 9
        a, b, c = X0+i, X1-i, Y0+i
        holes += (f" M{a} {Y1} V{c} H{b} V{Y1} H{b-t} V{c+t} H{a+t} V{Y1} Z")
    return f'<path fill-rule="evenodd" d="{block} {holes}"/>'

# ---------- B: split Shamseh (8-point star) ----------
def clip(poly, keep):
    out = []
    for i in range(len(poly)):
        a, b = poly[i-1], poly[i]
        ia, ib = keep(a), keep(b)
        if ia != ib:
            # intersect with vertical line
            xl = keep.x
            t = (xl - a[0]) / (b[0] - a[0]); out.append((xl, a[1] + t*(b[1]-a[1])))
        if ib: out.append(b)
    return out
class Keep:
    def __init__(s, x, left): s.x, s.left = x, left
    def __call__(s, p): return p[0] <= s.x if s.left else p[0] >= s.x
def shamseh(gap=14, shift=0, R=108, rot=0):
    r = R * math.cos(math.radians(45)) / math.cos(math.radians(22.5))
    pts = [((128 + (R if i%2==0 else r)*math.sin(math.radians(i*22.5+rot))),
            (128 - (R if i%2==0 else r)*math.cos(math.radians(i*22.5+rot)))) for i in range(16)]
    L = clip(pts, Keep(128 - gap/2, True)); Rr = clip(pts, Keep(128 + gap/2, False))
    def p(poly, dy): return "M" + " L".join(f"{f(x)} {f(y+dy)}" for x, y in poly) + " Z"
    return f'<path d="{p(Rr, -shift)} {p(L, shift)}"/>'

# ---------- C: banna'i (square Kufic) seal of مرزگاه ----------
SEAL = """
.........##
...#.....##
.........#.
..##..#####
.##..##....
...........
#####.#.###
#...#.#...#
#.#.#.#.###
#...#.#...#
#####.#####
"""
# fix row 2 so the mim is a closed ring (cols 8-10)
SEAL = """
........###
..#.....#.#
........#.#
####.######
#....#.....
...........
#####.#.###
#...#.#...#
#.#.#.#.###
#...#.#...#
#####.#####
"""
def bannai(grid=SEAL, u=20, ox=0, oy=0):
    rows = [r for r in grid.strip("\n").split("\n")]
    out = []
    for j, row in enumerate(rows):
        i = 0
        while i < len(row):
            if row[i] == "#":
                k = i
                while k < len(row) and row[k] == "#": k += 1
                out.append(f"M{ox+i*u} {oy+j*u}h{(k-i)*u}v{u}h{-(k-i)*u}z")
                i = k
            else: i += 1
    return f'<path d="{"".join(out)}"/>', len(rows[0])*u, len(rows)*u

def write(name, body, w=256, h=256):
    (OUT / name).write_text(svg(body, w, h))

def lockup(name, sym_body, sym_size=256, pad=0):
    fa, fw, fh = text_group("مرزگاه", ARAD, 190, wght=850)
    la, lw, lh = text_group("MARZGAH", VAZ, 46)
    H = 256; gap = 56
    s = (H*0.62) / fh                     # Persian wordmark height ~62% of lockup
    fw2 = fw * s
    ls = (fw2*0.62) / lw                  # latin spans 62% of persian width
    W = fw2 + gap + H
    body = f'<g transform="translate({f(W-H)} 0) scale({H/sym_size})">{sym_body}</g>'
    body += f'<g transform="translate(0 {f(H*0.06)}) scale({f(s)})">{fa}</g>'
    body += f'<g transform="translate({f(fw2 - lw*ls)} {f(H*0.78)}) scale({f(ls)})">{la}</g>'
    write(name, body, W, H)

if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    write("a-iwan.svg", iwan()); lockup("a-iwan-lockup.svg", iwan())
    write("a-iwan-small.svg", iwan(frame=False))
    write("b-shamseh.svg", shamseh()); lockup("b-shamseh-lockup.svg", shamseh())
    g, w, h = bannai(ox=18, oy=18); write("c-bannai.svg", g, 256, 256); lockup("c-bannai-lockup.svg", g)
    print("ok")
