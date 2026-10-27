"""Builds the final Marzgah logo kit (direction A, Iwan). Run: python3 brand/build_kit.py"""
import math, pathlib
from build import text_group, f

ROOT = pathlib.Path(__file__).parent
LOGO = ROOT / "logo"
PATTERN = ROOT / "pattern"
ARAD = "/Users/circle/Library/Fonts/AradVF.ttf"
POPPINS = "/Users/circle/Library/Fonts/Poppins-SemiBold.ttf"

# Palette
FIRUZEH = "#14968F"        # turquoise — the mark
FIRUZEH_LIGHT = "#3FC1B4"  # turquoise on dark grounds
LAJVARD = "#16294A"        # lapis ink — wordmark, dark ground
SAFFRON = "#E2A03F"
KAHGEL = "#F3ECE0"         # adobe sand — warm paper
ANAR = "#B2423A"
WHITE, BLACK = "#FFFFFF", "#000000"

# ---------- symbol geometry (256 grid) ----------
# Outer band 16 · frame channel 10 · inner pier 16 · doorway 84 · base line 16.
DY = -6  # optical centring: whole mark sits slightly above the geometric centre
X0, X1 = 44, 212
Y0, Y1 = 40 + DY, 208 + DY
BASE_H, BASE_X0, BASE_X1 = 16, 20, 236
SX0, SX1, SPRING, D = 86, 170, 138 + DY, 16
BBOX = (BASE_X0, Y0, BASE_X1 - BASE_X0, Y1 + BASE_H - Y0)  # x, y, w, h


def symbol_path(frame=True, channel=10, base=True):
    foot = Y1 + (BASE_H if base else 0)
    r = (SX1 - SX0) / 2 + D
    cx = (SX0 + SX1) / 2
    apex = SPRING - math.sqrt(r * r - D * D)
    arch = (f"M{SX0} {foot} V{f(SPRING)} A{f(r)} {f(r)} 0 0 1 {f(cx)} {f(apex)} "
            f"A{f(r)} {f(r)} 0 0 1 {SX1} {f(SPRING)} V{foot} Z")
    if base:
        block = f"M{X0} {Y0} H{X1} V{Y1} H{BASE_X1} V{Y1 + BASE_H} H{BASE_X0} V{Y1} H{X0} Z"
    else:
        block = f"M{X0} {Y0} H{X1} V{Y1} H{X0} Z"
    holes = arch
    if frame:
        i, t = 16, channel
        a, b, c = X0 + i, X1 - i, Y0 + i
        holes += f" M{a} {Y1} V{c} H{b} V{Y1} H{b - t} V{c + t} H{a + t} V{Y1} Z"
    return f'<path fill-rule="evenodd" d="{block} {holes}"/>'


def small_symbol_path():
    """16–32 px cut: no frame channel, wider doorway, heavier base."""
    x0, x1, y0, y1, bh = 40, 216, 36, 196, 28
    sx0, sx1, spring, d = 92, 164, 124, 14
    r = (sx1 - sx0) / 2 + d
    cx = (sx0 + sx1) / 2
    apex = spring - math.sqrt(r * r - d * d)
    foot = y1 + bh
    block = f"M{x0} {y0} H{x1} V{y1} H248 V{foot} H8 V{y1} H{x0} Z"
    arch = (f"M{sx0} {foot} V{spring} A{f(r)} {f(r)} 0 0 1 {f(cx)} {f(apex)} "
            f"A{f(r)} {f(r)} 0 0 1 {sx1} {spring} V{foot} Z")
    return f'<path fill-rule="evenodd" d="{block} {arch}"/>'


def doc(body, w, h, title, bg=None):
    rect = f'<rect width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" '
            f'width="{f(w)}" height="{f(h)}"><title>{title}</title>{rect}{body}</svg>\n')


# ---------- type ----------
def fa_word():
    g, w, h = text_group("مرزگاه", ARAD, 400, wght=850)
    return g, w, h


def en_word(target_w=None, size=200, track=0.16):
    """MARZGAH in Poppins SemiBold; equal ink gaps (optical tracking), optionally justified to target_w."""
    letters = [text_group(c, POPPINS, size) for c in "MARZGAH"]
    ink = sum(w for _, w, _ in letters)
    gap = (target_w - ink) / 6 if target_w else size * track
    out, x = [], 0
    hmax = max(h for _, _, h in letters)
    for g, w, h in letters:
        out.append(f'<g transform="translate({f(x)} {f(hmax - h)})">{g}</g>')
        x += w + gap
    return "".join(out), x - gap, hmax


def sym_group(x, y, height, fill, small=False, reversed_=False):
    s = height / BBOX[3]
    body = small_symbol_path() if small else symbol_path(channel=11 if reversed_ else 10)
    return (f'<g fill="{fill}" transform="translate({f(x)} {f(y)}) scale({f(s)}) '
            f'translate({-BBOX[0]} {-BBOX[1]})">{body}</g>')


def word_fa_group(x, y, height, fill):
    g, w, h = fa_word()
    s = height / h
    return f'<g fill="{fill}" transform="translate({f(x)} {f(y)}) scale({f(s)})">{g}</g>', w * s


def scheme(name):
    return {
        "color": (FIRUZEH, LAJVARD, None),
        "reversed": (FIRUZEH_LIGHT, WHITE, LAJVARD),
        "black": (BLACK, BLACK, None),
        "white": (WHITE, WHITE, None),
    }[name]


# ---------- lockups ----------
def horizontal(sch):
    """Persian-first (RTL): symbol on the right, wordmark to its left, Latin justified beneath."""
    sym_c, txt_c, bg = scheme(sch)
    SH = 200                                  # symbol height
    sw = SH * BBOX[2] / BBOX[3]
    g_fa, fw, fh = fa_word()
    fa_h = SH * 0.70
    fa_w = fw * fa_h / fh
    en_h_target = SH * 0.15
    _, _, eh = en_word()
    # justify Latin to Persian width
    s_en = en_h_target / eh
    g_en, ew, eh = en_word(target_w=fa_w / s_en)
    gap = SH * 0.30                           # symbol ↔ wordmark = ½ doorway
    pad = SH * 0.25 if bg else 0
    W = fa_w + gap + sw + 2 * pad
    H = SH + 2 * pad
    body = sym_group(pad + fa_w + gap, pad, SH, sym_c, reversed_=bg is not None)
    body += f'<g fill="{txt_c}">'
    body += word_fa_group(pad, pad - SH * 0.02, fa_h, txt_c)[0]
    body += f'<g transform="translate({f(pad)} {f(pad + SH - en_h_target)}) scale({f(s_en)})">{g_en}</g>'
    body += "</g>"
    return doc(body, W, H, "Marzgah — مرزگاه", bg)


def stacked(sch):
    sym_c, txt_c, bg = scheme(sch)
    SH = 200
    sw = SH * BBOX[2] / BBOX[3]
    g_fa, fw, fh = fa_word()
    fa_h = SH * 0.62
    fa_w = fw * fa_h / fh
    en_h = SH * 0.13
    _, _, eh = en_word()
    s_en = en_h / eh
    g_en, ew, eh = en_word(target_w=fa_w / s_en)
    pad = SH * 0.25 if bg else 0
    W = max(sw, fa_w) + 2 * pad
    y = pad
    body = sym_group((W - sw) / 2, y, SH, sym_c, reversed_=bg is not None)
    y += SH + SH * 0.20
    body += word_fa_group((W - fa_w) / 2, y, fa_h, txt_c)[0]
    y += fa_h + SH * 0.12
    body += f'<g fill="{txt_c}" transform="translate({f((W - fa_w) / 2)} {f(y)}) scale({f(s_en)})">{g_en}</g>'
    H = y + en_h + pad
    return doc(body, W, H, "Marzgah — مرزگاه", bg)


def horizontal_en(sch):
    """Latin-first (LTR) contexts: symbol on the left, MARZGAH to the right."""
    sym_c, txt_c, bg = scheme(sch)
    SH = 200
    sw = SH * BBOX[2] / BBOX[3]
    en_h = SH * 0.28
    g_en, ew, eh = en_word(track=0.10)
    s = en_h / eh
    gap = SH * 0.24
    pad = SH * 0.25 if bg else 0
    W = sw + gap + ew * s + 2 * pad
    H = SH + 2 * pad
    body = sym_group(pad, pad, SH, sym_c, reversed_=bg is not None)
    # cap height aligned to sit on the base line's top edge, optically centred on the gate
    ty = pad + SH * (Y1 - BBOX[1]) / BBOX[3] - en_h
    body += f'<g fill="{txt_c}" transform="translate({f(pad + sw + gap)} {f(ty)}) scale({f(s)})">{g_en}</g>'
    return doc(body, W, H, "Marzgah", bg)


def wordmark_fa(sch):
    _, txt_c, bg = scheme(sch)
    g, w, h = fa_word()
    pad = h * 0.3 if bg else 0
    body = f'<g fill="{txt_c}" transform="translate({f(pad)} {f(pad)})">{g}</g>'
    return doc(body, w + 2 * pad, h + 2 * pad, "مرزگاه", bg)


def symbol_doc(sch, small=False):
    sym_c, _, bg = scheme(sch)
    body = f'<g fill="{sym_c}">{small_symbol_path() if small else symbol_path(channel=11 if bg else 10)}</g>'
    return doc(body, 256, 256, "Marzgah symbol", bg)


# ---------- pattern: caravanserai arcade ----------
def arcade_tile(fg=FIRUZEH, bg=KAHGEL, u=64):
    """Caravanserai façade: a solid wall pierced by pointed doorways, one per cell."""
    w, h = u * 0.46, u * 0.66
    d = w * 0.18
    r = w / 2 + d
    rise = math.sqrt(r * r - d * d)
    holes = []
    for col in range(2):
        for row in range(2):
            cx = col * u + u / 2
            foot = row * u + u * 0.86
            spring = foot - h + rise
            holes.append(f"M{f(cx - w/2)} {f(foot)} V{f(spring)} A{f(r)} {f(r)} 0 0 1 {f(cx)} {f(foot - h)} "
                         f"A{f(r)} {f(r)} 0 0 1 {f(cx + w/2)} {f(spring)} V{f(foot)} Z")
            # thin border line under each row, broken at the doorway
    wall = f"M0 0 H{2*u} V{2*u} H0 Z"
    lines = "".join(f'<rect x="0" y="{f(row*u + u*0.86)}" width="{2*u}" height="{f(u*0.06)}" fill="{bg}"/>' for row in range(2))
    body = f'<path fill="{fg}" fill-rule="evenodd" d="{wall} {" ".join(holes)}"/>{lines}'
    return doc(body, 2 * u, 2 * u, "Marzgah arcade pattern", bg)


def main():
    LOGO.mkdir(exist_ok=True)
    PATTERN.mkdir(exist_ok=True)
    for sch in ["color", "reversed", "black", "white"]:
        (LOGO / f"marzgah-horizontal-{sch}.svg").write_text(horizontal(sch))
        (LOGO / f"marzgah-stacked-{sch}.svg").write_text(stacked(sch))
        (LOGO / f"marzgah-horizontal-en-{sch}.svg").write_text(horizontal_en(sch))
        (LOGO / f"marzgah-wordmark-fa-{sch}.svg").write_text(wordmark_fa(sch))
        (LOGO / f"marzgah-symbol-{sch}.svg").write_text(symbol_doc(sch))
        (LOGO / f"marzgah-symbol-small-{sch}.svg").write_text(symbol_doc(sch, small=True))
    (PATTERN / "arcade-sand.svg").write_text(arcade_tile(fg="#E9DFCD", bg=KAHGEL))
    (PATTERN / "arcade-lajvard.svg").write_text(arcade_tile(fg="#1D3560", bg=LAJVARD))
    (PATTERN / "arcade-firuzeh.svg").write_text(arcade_tile(fg="#1AA198", bg=FIRUZEH))
    print("kit ok")


if __name__ == "__main__":
    main()
