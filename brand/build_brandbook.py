"""Builds brand/brandbook.html (self-contained). Run after build_kit.py: python3 brand/build_brandbook.py"""
import base64, math, pathlib, re
import build_kit as K

ROOT = pathlib.Path(__file__).parent
ARAD_WOFF2 = ROOT.parent / "public" / "Arad-VF.woff2"

PALETTE = [
    # key, English, Persian, hex, role, nearest Pantone (verify on a swatch book)
    ("firuzeh", "Firuzeh", "فیروزه", K.FIRUZEH, "The mark. Graphics, icons, highlights.", "7716 C"),
    ("firuzeh-deep", "Firuzeh Deep", "فیروزه‌ی تیره", "#0D6F6A", "Turquoise for text, links and buttons on light grounds.", "3292 C"),
    ("lajvard", "Lajvard", "لاجورد", K.LAJVARD, "Wordmark, headings, dark grounds.", "2767 C"),
    ("kahgel", "Kahgel", "کاه‌گل", K.KAHGEL, "Warm paper. Page and print grounds.", "9224 C"),
    ("saffron", "Za'feran", "زعفران", K.SAFFRON, "Accent only: badges, renewal prompts, one per screen.", "7563 C"),
    ("anar", "Anar", "انار", K.ANAR, "Errors, debt, expired subscriptions.", "7621 C"),
]


def lum(h):
    c = [int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = sorted([lum(a), lum(b)], reverse=True)
    return (la + 0.05) / (lb + 0.05)


def rgb(h):
    return tuple(int(h.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4))


def cmyk(h):
    r, g, b = (x / 255 for x in rgb(h))
    k = 1 - max(r, g, b)
    if k == 1:
        return (0, 0, 0, 100)
    return tuple(round(100 * v) for v in ((1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k))


def inline(path, cls="", label=None):
    s = (ROOT / path).read_text()
    s = re.sub(r"<\?xml[^>]*>\s*", "", s)
    s = re.sub(r'\s(width|height)="[^"]*"', "", s, count=2)
    attrs = f' class="{cls}"' if cls else ""
    attrs += f' role="img" aria-label="{label}"' if label else ' aria-hidden="true"'
    return s.replace("<svg ", f"<svg{attrs} ", 1)


def data_uri(path):
    return "data:image/svg+xml;base64," + base64.b64encode((ROOT / path).read_bytes()).decode()


# ---------- diagrams ----------
def construction_svg():
    """Symbol on its 256 grid with the measurements that define it."""
    x0, x1, y0, y1 = K.X0, K.X1, K.Y0, K.Y1
    r = (K.SX1 - K.SX0) / 2 + K.D
    cx = (K.SX0 + K.SX1) / 2
    grid = "".join(f'<line x1="{v}" y1="0" x2="{v}" y2="256"/><line x1="0" y1="{v}" x2="256" y2="{v}"/>'
                   for v in range(0, 257, 16))
    centres = (f'<circle cx="{cx - K.D}" cy="{K.SPRING}" r="2.4"/><circle cx="{cx + K.D}" cy="{K.SPRING}" r="2.4"/>')
    arcs = (f'<circle cx="{cx - K.D}" cy="{K.SPRING}" r="{r}"/><circle cx="{cx + K.D}" cy="{K.SPRING}" r="{r}"/>'
            f'<line x1="0" y1="{K.SPRING}" x2="256" y2="{K.SPRING}"/>')

    def dim(xa, ya, xb, yb, label, lx, ly):
        return (f'<line x1="{xa}" y1="{ya}" x2="{xb}" y2="{yb}"/>'
                f'<text x="{lx}" y="{ly}">{label}</text>')
    dims = (dim(K.SX0, y1 - 22, K.SX1, y1 - 22, "doorway 84", cx, y1 - 26)
            + dim(x0, y0 - 8, x0 + 16, y0 - 8, "16", x0 + 8, y0 - 11)
            + dim(x0 + 16, y0 - 8, x0 + 26, y0 - 8, "10", x0 + 21, y0 - 11)
            + dim(x0 + 26, y0 - 8, K.SX0, y0 - 8, "16", (x0 + 26 + K.SX0) / 2, y0 - 11)
            + dim(K.BASE_X0, y1 + 24, K.BASE_X1, y1 + 24, "border line 216 × 16", 128, y1 + 34))
    return f'''<svg class="construct" viewBox="-8 -8 272 272" role="img" aria-label="Construction grid of the Marzgah symbol">
  <g class="c-grid">{grid}</g>
  <g class="c-mark">{K.symbol_path()}</g>
  <g class="c-guide">{arcs}</g>
  <g class="c-centre">{centres}</g>
  <g class="c-dim">{dims}</g>
</svg>'''


def clearspace_svg():
    s = inline("logo/marzgah-horizontal-color.svg")
    vb = re.search(r'viewBox="0 0 ([\d.]+) ([\d.]+)"', s).groups()
    w, h = float(vb[0]), float(vb[1])
    sh = 200
    unit = 84 * sh / K.BBOX[3] / 2          # half the doorway, in lockup units
    inner = re.sub(r"^<svg[^>]*>|</svg>$", "", s.strip())
    inner = re.sub(r"<title>.*?</title>", "", inner)
    p = unit
    gate = lambda x, y: f'<rect class="cs-unit" x="{x:.1f}" y="{y:.1f}" width="{p:.1f}" height="{p:.1f}"/>'
    return f'''<svg class="clearspace" viewBox="{-p - 6:.1f} {-p - 6:.1f} {w + 2 * p + 12:.1f} {h + 2 * p + 12:.1f}" role="img" aria-label="Clear space around the horizontal logo equals half the doorway width">
  <rect class="cs-zone" x="{-p:.1f}" y="{-p:.1f}" width="{w + 2 * p:.1f}" height="{h + 2 * p:.1f}"/>
  <rect class="cs-box" x="0" y="0" width="{w:.1f}" height="{h:.1f}"/>
  {inner}
  {gate(-p, -p)}{gate(w, -p)}{gate(-p, h)}{gate(w, h)}
</svg>'''


def swatches():
    out = []
    for key, en, fa, hx, role, pantone in PALETTE:
        r, g, b = rgb(hx)
        c, m, y, k = cmyk(hx)
        on_white = contrast(hx, "#FFFFFF")
        on_lajvard = contrast(hx, K.LAJVARD)
        ink = "#FFFFFF" if lum(hx) < 0.3 else K.LAJVARD
        out.append(f'''<article class="swatch">
  <div class="chip" style="background:{hx};color:{ink}"><span class="fa" lang="fa">{fa}</span><span>{en}</span></div>
  <dl>
    <dt>HEX</dt><dd><code>{hx.upper()}</code></dd>
    <dt>RGB</dt><dd>{r} {g} {b}</dd>
    <dt>CMYK</dt><dd>{c} {m} {y} {k}</dd>
    <dt>Pantone</dt><dd>{pantone}<sup>*</sup></dd>
    <dt>On white</dt><dd>{on_white:.1f} : 1</dd>
    <dt>On lajvard</dt><dd>{on_lajvard:.1f} : 1</dd>
  </dl>
  <p>{role}</p>
</article>''')
    return "\n".join(out)


def misuse():
    sym = inline("logo/marzgah-symbol-color.svg")
    hz = inline("logo/marzgah-horizontal-color.svg")
    word = inline("logo/marzgah-wordmark-fa-color.svg")
    items = [
        (f'<div class="mx stretch">{hz}</div>', "Don't stretch or squash the logo."),
        (f'<div class="mx rotate">{sym}</div>', "Don't rotate or tilt the gate. It always stands on its border line."),
        (f'<div class="mx recolor">{hz}</div>', "Don't recolour the mark outside the palette."),
        (f'<div class="mx swap"><span class="mx-sym">{sym}</span><span class="mx-word">{word}</span></div>',
         "Don't put the symbol to the left of the Persian wordmark. Persian reads right to left, so the gate leads."),
        ('<div class="mx retype"><span class="mx-sym">' + sym + '</span><span class="naskh" lang="fa">مرزگاه</span></div>',
         "Don't retype the wordmark in another font. Use the supplied artwork."),
        (f'<div class="mx busy" style="background-image:url({data_uri("pattern/arcade-firuzeh.svg")})">{sym}</div>',
         "Don't place the turquoise mark on turquoise or busy grounds."),
    ]
    return "\n".join(f'<figure class="dont"><div class="dont-art">{art}</div><figcaption>{cap}</figcaption></figure>'
                     for art, cap in items)


# ---------- page ----------
def page():
    arad = base64.b64encode(ARAD_WOFF2.read_bytes()).decode()
    small_sizes = "".join(
        f'<div class="ms"><div style="width:{px}px;height:{px}px">{inline("logo/marzgah-symbol-small-color.svg" if px <= 24 else "logo/marzgah-symbol-color.svg")}</div><span>{px} px</span></div>'
        for px in (16, 24, 32, 48, 64))
    pattern_sand = data_uri("pattern/arcade-sand.svg")
    pattern_laj = data_uri("pattern/arcade-lajvard.svg")
    pattern_fir = data_uri("pattern/arcade-firuzeh.svg")
    app_icon = inline("web/marzgah-app-icon.svg", "app-icon")

    return f'''<title>Marzgah Brandbook</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&display=swap">
<style>
@font-face {{ font-family: "Arad"; src: url(data:font/woff2;base64,{arad}) format("woff2"); font-weight: 100 900; font-display: swap; }}
/* Layout: a left rail of chapters, each chapter opened by the border line with its gate. */
:root {{
  --firuzeh: {K.FIRUZEH}; --firuzeh-deep: #0D6F6A; --firuzeh-light: {K.FIRUZEH_LIGHT};
  --lajvard: {K.LAJVARD}; --kahgel: {K.KAHGEL}; --saffron: {K.SAFFRON}; --anar: {K.ANAR};
  --bg: #FBF9F5; --surface: #FFFFFF; --sunk: #F3ECE0; --fg: #16294A; --muted: #5A6478; --line: #E4DCCD;
  --link: var(--firuzeh-deep); --grid: #E9E3D7; --bad: #B2423A;
  --font-fa: "Arad", "Vazirmatn", Tahoma, sans-serif;
  --font-en: "Poppins", "Arad", ui-sans-serif, system-ui, sans-serif;
  --step--1: .82rem; --step-0: 1rem; --step-1: 1.25rem; --step-2: 1.7rem; --step-3: 2.4rem; --step-4: 3.4rem;
}}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{
  --bg: #0E1A30; --surface: #14233F; --sunk: #0A1426; --fg: #ECE6DA; --muted: #A3AEC2; --line: #263A5E;
  --link: var(--firuzeh-light); --grid: #1E3152; --bad: #E07A70; color-scheme: dark; }} }}
:root[data-theme="dark"] {{
  --bg: #0E1A30; --surface: #14233F; --sunk: #0A1426; --fg: #ECE6DA; --muted: #A3AEC2; --line: #263A5E;
  --link: var(--firuzeh-light); --grid: #1E3152; --bad: #E07A70; color-scheme: dark; }}
* {{ box-sizing: border-box; }}
body {{ background: var(--bg); color: var(--fg); font-family: var(--font-en); font-size: var(--step-0); line-height: 1.65; }}
.fa, [lang="fa"] {{ font-family: var(--font-fa); }}
a {{ color: var(--link); }}
:focus-visible {{ outline: 2px solid var(--firuzeh); outline-offset: 2px; }}
code {{ font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .88em; }}
h1, h2, h3 {{ text-wrap: balance; line-height: 1.15; margin: 0; font-weight: 600; }}
p {{ margin: 0; max-width: 65ch; }}
.eyebrow {{ font-size: var(--step--1); letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 500; }}

/* cover */
.cover {{ background: var(--lajvard) url({pattern_laj}) repeat; background-size: 96px; color: #fff; }}
.cover-in {{ max-width: 1180px; margin: 0 auto; padding-block: clamp(48px, 9vw, 112px);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 32px; align-items: end; }}
.cover h1 {{ font-size: var(--step-4); letter-spacing: -.01em; }}
.cover h1 .fa {{ display: block; font-size: .8em; font-weight: 800; color: var(--firuzeh-light); margin-bottom: .2em; }}
.cover p {{ color: #C9D3E4; margin-top: 16px; }}
.cover-mark {{ width: clamp(120px, 22vw, 240px); }}
.cover-mark svg {{ width: 100%; height: auto; display: block; }}
.cover-mark svg rect {{ fill: transparent; }}

/* shell */
.shell {{ max-width: 1180px; margin: 0 auto; display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: 56px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 48px 96px; }}
nav.toc {{ position: sticky; top: calc(env(safe-area-inset-top, 0px) + 24px); align-self: start; display: grid; gap: 2px; font-size: var(--step--1); }}
nav.toc a {{ display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; border-radius: 6px; color: var(--muted); text-decoration: none; }}
nav.toc a:hover {{ color: var(--fg); background: var(--sunk); }}
nav.toc a .fa {{ font-size: .95em; }}
main {{ display: grid; gap: 88px; min-width: 0; }}
section {{ display: grid; gap: 28px; min-width: 0; scroll-margin-top: 24px; }}
.marz {{ display: flex; align-items: flex-end; gap: 0; color: var(--firuzeh); height: 22px; }}
.marz i {{ flex: 1; height: 3px; background: currentColor; }}
.marz b {{ width: 18px; height: 22px; margin-inline: 6px; background: currentColor;
  -webkit-mask: url({data_uri("logo/marzgah-symbol-small-black.svg")}) center / contain no-repeat;
          mask: url({data_uri("logo/marzgah-symbol-small-black.svg")}) center / contain no-repeat; }}
.sec-head {{ display: grid; gap: 10px; }}
.sec-head h2 {{ font-size: var(--step-3); display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 16px; }}
.sec-head h2 .fa {{ font-size: .7em; color: var(--muted); font-weight: 700; }}
.lede {{ font-size: var(--step-1); line-height: 1.5; color: var(--fg); max-width: 60ch; }}
.cols {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }}
.card {{ background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 24px; display: grid; gap: 10px; align-content: start; min-width: 0; }}
.card h3 {{ font-size: var(--step-1); }}
.muted {{ color: var(--muted); }}

/* idea */
.name-split {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; }}
.name-split .part {{ background: var(--sunk); border-radius: 12px; padding: 20px 24px; display: grid; gap: 4px; }}
.name-split .big {{ font-family: var(--font-fa); font-size: 2.6rem; font-weight: 800; line-height: 1.2; color: var(--fg); }}
.adjs {{ display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0; }}
.adjs li {{ border: 1px solid var(--line); border-radius: 999px; padding: 6px 14px; background: var(--surface); }}
.adjs li .fa {{ color: var(--muted); margin-inline-start: 6px; }}

/* logo stage */
.stage {{ border-radius: 14px; padding: clamp(24px, 5vw, 56px); display: grid; place-items: center; min-height: 220px; }}
.stage svg {{ max-width: 100%; height: auto; max-height: 180px; display: block; }}
.stage.light {{ background: #fff; border: 1px solid var(--line); }}
.stage.sand {{ background: var(--kahgel); }}
.stage.dark {{ background: var(--lajvard); }}
.stage.dark svg > rect:first-of-type {{ fill: transparent; }}
.stage.teal {{ background: var(--firuzeh); }}
.versions {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }}
.version {{ display: grid; gap: 12px; align-content: start; }}
.version .stage {{ min-height: 200px; }}
.version h3 {{ font-size: var(--step-0); }}
.version p {{ font-size: var(--step--1); color: var(--muted); }}

/* construction */
.construct-wrap {{ display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 32px; align-items: center; }}
.construct {{ width: 100%; height: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; }}
.c-grid line {{ stroke: var(--grid); stroke-width: .6; }}
.c-mark {{ fill: var(--firuzeh); opacity: .92; }}
.c-guide circle, .c-guide line {{ fill: none; stroke: var(--fg); stroke-width: .6; stroke-dasharray: 3 3; opacity: .55; }}
.c-centre circle {{ fill: var(--saffron); }}
.c-dim line {{ stroke: var(--fg); stroke-width: .8; }}
.c-dim text {{ fill: var(--fg); font: 600 7px var(--font-en); text-anchor: middle; }}
.facts {{ display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }}
.facts li {{ display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }}
.facts b {{ font-weight: 600; }}

/* clear space */
.clearspace {{ width: 100%; height: auto; max-height: 300px; }}
.cs-zone {{ fill: color-mix(in srgb, var(--firuzeh) 10%, transparent); stroke: var(--firuzeh); stroke-dasharray: 6 5; stroke-width: 1.5; }}
.cs-box {{ fill: #fff; stroke: var(--line); }}
.cs-unit {{ fill: color-mix(in srgb, var(--saffron) 55%, transparent); }}
.minsizes {{ display: flex; flex-wrap: wrap; gap: 28px; align-items: end; }}
.ms {{ display: grid; gap: 8px; justify-items: center; font-size: var(--step--1); color: var(--muted); }}
.ms svg {{ width: 100%; height: 100%; display: block; }}
table {{ border-collapse: collapse; width: 100%; font-size: var(--step--1); }}
.table-wrap {{ overflow-x: auto; }}
th, td {{ text-align: start; padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }}
th {{ font-weight: 600; color: var(--muted); }}
td.num {{ font-variant-numeric: tabular-nums; }}

/* colour */
.swatches {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }}
.swatch {{ background: var(--surface); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; display: grid; align-content: start; }}
.chip {{ height: 132px; padding: 16px 18px; display: flex; flex-direction: column; justify-content: flex-end; font-weight: 600; }}
.chip .fa {{ font-size: 1.5rem; font-weight: 800; line-height: 1.2; }}
.swatch dl {{ display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0; padding: 16px 18px 6px; font-size: var(--step--1); font-variant-numeric: tabular-nums; }}
.swatch dt {{ color: var(--muted); }}
.swatch dd {{ margin: 0; }}
.swatch p {{ padding: 6px 18px 18px; font-size: var(--step--1); color: var(--muted); }}
.ratio {{ display: grid; grid-template-columns: 6fr 2fr 1.2fr .5fr .3fr; height: 44px; border-radius: 10px; overflow: hidden; }}
.footnote {{ font-size: var(--step--1); color: var(--muted); }}

/* type */
.specimen {{ display: grid; gap: 18px; }}
.spec-fa {{ font-family: var(--font-fa); direction: rtl; text-align: right; }}
.spec-fa .d {{ font-size: clamp(2.2rem, 6vw, 3.6rem); font-weight: 850; line-height: 1.3; }}
.spec-fa .b {{ font-size: 1.1rem; line-height: 2; max-width: none; }}
.spec-en .d {{ font-size: clamp(2rem, 5vw, 3.2rem); font-weight: 600; line-height: 1.15; }}
.weights {{ display: flex; flex-wrap: wrap; gap: 10px 22px; font-size: 1.3rem; }}
.scale-row {{ display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 16px; align-items: baseline; padding-block: 10px; border-bottom: 1px solid var(--line); }}
.scale-row span:first-child {{ font-size: var(--step--1); color: var(--muted); font-variant-numeric: tabular-nums; }}
.rules {{ display: grid; gap: 12px; padding: 0; margin: 0; list-style: none; }}
.rules li {{ padding-inline-start: 18px; position: relative; }}
.rules li::before {{ content: ""; position: absolute; inset-inline-start: 0; top: .7em; width: 8px; height: 3px; background: var(--firuzeh); }}
.rtl {{ direction: rtl; unicode-bidi: isolate; font-family: var(--font-fa); }}

/* pattern */
.patterns {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }}
.pat {{ height: 200px; border-radius: 14px; background-size: 80px; display: flex; align-items: flex-end; padding: 14px 16px; font-size: var(--step--1); font-weight: 600; }}

/* applications */
.apps {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; }}
.app {{ border-radius: 14px; overflow: hidden; border: 1px solid var(--line); background: var(--surface); display: grid; grid-template-rows: auto 1fr; }}
.app figcaption {{ padding: 12px 16px; font-size: var(--step--1); color: var(--muted); border-top: 1px solid var(--line); order: 2; }}
.app-art {{ padding: 24px; display: grid; place-items: center; min-height: 260px; }}
.ui {{ direction: rtl; font-family: var(--font-fa); color: #16294A; width: 100%; max-width: 330px; }}
.ui-side {{ background: #fff; border-radius: 12px; border: 1px solid #E4DCCD; padding: 12px; display: grid; gap: 10px; }}
.ui-brand {{ display: flex; align-items: center; gap: 10px; }}
.ui-tile {{ width: 36px; height: 36px; border-radius: 9px; background: var(--lajvard); display: grid; place-items: center; }}
.ui-tile svg {{ width: 24px; height: 24px; }}
.ui-brand b {{ display: block; font-weight: 800; font-size: 1rem; line-height: 1.2; }}
.ui-brand small {{ color: #5A6478; font-size: .78rem; }}
.ui-item {{ padding: 8px 10px; border-radius: 8px; font-size: .88rem; }}
.ui-item.on {{ background: #E5F3F2; color: #0D6F6A; font-weight: 700; }}
.ui-card {{ background: #fff; border-radius: 14px; border: 1px solid #E4DCCD; padding: 20px; display: grid; gap: 12px; text-align: center; }}
.ui-card .lock {{ width: 150px; margin: 0 auto 4px; }}
.ui-card .lock svg {{ width: 100%; height: auto; }}
.ui-field {{ height: 38px; border: 1px solid #E4DCCD; border-radius: 8px; background: #FBF9F5; text-align: right; padding: 8px 12px; font-size: .82rem; color: #8790A3; }}
.ui-btn {{ height: 40px; border-radius: 8px; background: #0D6F6A; color: #fff; font-weight: 700; display: grid; place-items: center; font-size: .9rem; }}
.ui-sub {{ background: #fff; border-radius: 14px; border: 1px solid #E4DCCD; overflow: hidden; }}
.ui-sub header {{ background: var(--lajvard) url({pattern_laj}) repeat; background-size: 56px; color: #fff; padding: 16px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }}
.ui-sub header svg {{ height: 34px; width: auto; }}
.ui-sub .body {{ padding: 16px; display: grid; gap: 12px; font-size: .88rem; }}
.ui-bar {{ height: 8px; border-radius: 99px; background: #EEE7DA; overflow: hidden; }}
.ui-bar i {{ display: block; height: 100%; width: 62%; background: var(--firuzeh); border-radius: 99px; }}
.ui-row {{ display: flex; justify-content: space-between; }}
.ui-pill {{ display: inline-block; background: var(--saffron); color: #16294A; border-radius: 99px; padding: 2px 10px; font-weight: 700; font-size: .78rem; }}
.tg {{ display: flex; align-items: center; gap: 14px; background: #fff; border-radius: 14px; border: 1px solid #E4DCCD; padding: 14px 16px; width: 100%; max-width: 330px; direction: rtl; font-family: var(--font-fa); color: #16294A; }}
.tg .av {{ width: 54px; height: 54px; border-radius: 50%; overflow: hidden; flex: none; }}
.tg .av svg {{ width: 100%; height: 100%; display: block; }}
.tg b {{ display: block; }}
.tg small {{ color: #5A6478; }}

/* voice */
.voice {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
.say {{ border-radius: 12px; padding: 18px 20px; display: grid; gap: 8px; border: 1px solid var(--line); background: var(--surface); }}
.say .tag {{ font-size: var(--step--1); font-weight: 600; }}
.say.yes .tag {{ color: var(--link); }}
.say.no .tag {{ color: var(--bad); }}
.say q {{ quotes: none; font-family: var(--font-fa); direction: rtl; text-align: right; font-size: 1.08rem; line-height: 1.9; }}

/* misuse */
.donts {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }}
.dont {{ margin: 0; display: grid; gap: 10px; align-content: start; }}
.dont-art {{ position: relative; height: 170px; border-radius: 12px; background: #fff; border: 1px solid var(--line); display: grid; place-items: center; overflow: hidden; padding: 16px; }}
.dont-art::after {{ content: ""; position: absolute; inset-inline-end: 10px; top: 10px; width: 22px; height: 22px; border-radius: 50%;
  background: var(--anar) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 22 22'%3E%3Cpath d='M7 7l8 8M15 7l-8 8' stroke='white' stroke-width='2.4' stroke-linecap='round'/%3E%3C/svg%3E") center / 100% no-repeat; }}
.dont figcaption {{ font-size: var(--step--1); color: var(--muted); }}
.mx svg {{ display: block; height: 90px; width: auto; max-width: 100%; }}
.mx.stretch svg {{ transform: scaleX(1.45) scaleY(.8); height: 60px; }}
.mx.rotate svg {{ transform: rotate(-14deg); }}
.mx.recolor svg {{ height: 60px; filter: hue-rotate(150deg) saturate(1.6); }}
.mx.swap, .mx.retype {{ display: flex; align-items: center; gap: 12px; }}
.mx.swap svg, .mx.retype svg {{ height: 60px; }}
.mx.swap .mx-word svg {{ height: 46px; }}
.mx.retype .naskh {{ font-family: "Times New Roman", "Noto Naskh Arabic", serif; font-size: 2.6rem; color: var(--lajvard); line-height: 1; }}
.mx.busy {{ width: 100%; height: 100%; display: grid; place-items: center; background-size: 60px; }}

/* files */
.files {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }}
.files code {{ display: block; color: var(--link); margin-bottom: 4px; }}

footer {{ border-top: 1px solid var(--line); padding-block: 28px 40px; color: var(--muted); font-size: var(--step--1);
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); }}
footer div {{ max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; }}

@media (max-width: 880px) {{
  .shell {{ grid-template-columns: minmax(0, 1fr); gap: 32px; }}
  nav.toc {{ position: static; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }}
  .construct-wrap {{ grid-template-columns: minmax(0, 1fr); }}
  .cover-in {{ grid-template-columns: minmax(0, 1fr); }}
}}
@media (prefers-reduced-motion: no-preference) {{ html {{ scroll-behavior: smooth; }} }}
</style>

<header class="cover">
  <div class="cover-in">
    <div>
      <p class="eyebrow" style="color:#9FB0CC">Brandbook · Version 1.0 · October 2026</p>
      <h1><span class="fa" lang="fa">راهنمای برند مرزگاه</span>Marzgah Brandbook</h1>
      <p>How the Marzgah identity is built and used: the mark, its versions, colour, type, pattern, voice and files. Use this book whenever you put the brand on a screen, a page or a product.</p>
    </div>
    <div class="cover-mark">{inline("logo/marzgah-symbol-reversed.svg", label="Marzgah symbol")}</div>
  </div>
</header>

<div class="shell">
  <nav class="toc" aria-label="Chapters">
    <a href="#idea"><span>Idea</span><span class="fa" lang="fa">ایده</span></a>
    <a href="#mark"><span>The mark</span><span class="fa" lang="fa">نشانه</span></a>
    <a href="#versions"><span>Versions</span><span class="fa" lang="fa">نسخه‌ها</span></a>
    <a href="#space"><span>Space &amp; size</span><span class="fa" lang="fa">حریم</span></a>
    <a href="#colour"><span>Colour</span><span class="fa" lang="fa">رنگ</span></a>
    <a href="#type"><span>Typography</span><span class="fa" lang="fa">حروف</span></a>
    <a href="#pattern"><span>Pattern</span><span class="fa" lang="fa">نقش</span></a>
    <a href="#apps"><span>In use</span><span class="fa" lang="fa">کاربرد</span></a>
    <a href="#voice"><span>Voice</span><span class="fa" lang="fa">لحن</span></a>
    <a href="#misuse"><span>Misuse</span><span class="fa" lang="fa">نادرست</span></a>
    <a href="#files"><span>Files</span><span class="fa" lang="fa">فایل‌ها</span></a>
  </nav>

  <main>
    <section id="idea">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 1</p><h2>The idea <span class="fa" lang="fa">ایده</span></h2></div>
      <p class="lede">Marzgah means “the place at the border”. On the old roads of Iran, that place was the caravanserai gate: the point where a guarded border opened for travellers who had the right papers. The panel does the same job for Marzban servers. Admins and resellers keep the border; customers pass through.</p>
      <div class="name-split">
        <div class="part"><span class="big" lang="fa">مرز</span><b>marz</b><span class="muted">border, frontier</span></div>
        <div class="part"><span class="big" lang="fa">گاه</span><b>-gāh</b><span class="muted">place, station</span></div>
        <div class="part"><span class="big" lang="fa">مرزگاه</span><b>Marzgah</b><span class="muted">the border post, the gate</span></div>
      </div>
      <div class="cols">
        <div class="card"><h3>Personality</h3>
          <ul class="adjs">
            <li>Persian <span class="fa" lang="fa">ایرانی</span></li><li>Trustworthy <span class="fa" lang="fa">امین</span></li>
            <li>Orderly <span class="fa" lang="fa">منظم</span></li><li>Open <span class="fa" lang="fa">گشوده</span></li>
          </ul>
          <p class="muted">A gatehouse, not a hacker tool. Calm, exact and welcoming to people who are allowed in.</p></div>
        <div class="card"><h3>Writing the name</h3>
          <p>Persian: <b lang="fa" class="fa">مرزگاه</b>, one word with no space or half-space.<br>Latin: <b>Marzgah</b> in running text. Use <b>MARZGAH</b> only inside the logo.</p>
          <p class="muted">Not “MarzGah”, “Marzgaah” or “Marz Gah”.</p></div>
      </div>
    </section>

    <section id="mark">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 2</p><h2>The mark <span class="fa" lang="fa">نشانه</span></h2></div>
      <p class="lede">An iwan, the framed Persian portal, set into a border line. The line runs unbroken except at one place: the doorway.</p>
      <div class="construct-wrap">
        {construction_svg()}
        <ul class="facts">
          <li><b>Grid</b><span>Built on a 256-unit square in steps of 16. The outer band, inner pier and border line are all 16 units.</span></li>
          <li><b>Frame</b><span>A 10-unit channel separates the frame from the piers, like the decorated border of a <i>pishtaq</i>, the portal façade.</span></li>
          <li><b>Arch</b><span>A pointed two-centred arch. Its centres (saffron dots) sit 16 units either side of the axis, with a radius of 58.</span></li>
          <li><b>Border</b><span>The base line runs 216 units wide and is cut only by the 84-unit doorway.</span></li>
          <li><b>Optics</b><span>The mark sits 6 units above the geometric centre, so it looks centred. On dark grounds the channel opens to 11 units to offset light bleed.</span></li>
        </ul>
      </div>
    </section>

    <section id="versions">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 3</p><h2>Logo versions <span class="fa" lang="fa">نسخه‌ها</span></h2></div>
      <p class="lede">Persian comes first. In Persian layouts the gate stands to the right of the wordmark, where reading begins. Use the Latin-first version only where the surrounding text is English.</p>
      <div class="stage light">{inline("logo/marzgah-horizontal-color.svg", label="Marzgah horizontal logo")}</div>
      <div class="versions">
        <div class="version"><div class="stage light">{inline("logo/marzgah-stacked-color.svg", label="Stacked logo")}</div><h3>Stacked</h3><p>Square spaces such as the login card, splash screens, posters and social posts.</p></div>
        <div class="version"><div class="stage light">{inline("logo/marzgah-horizontal-en-color.svg", label="Latin logo")}</div><h3>Latin horizontal</h3><p>English documents, GitHub and the README. The gate leads on the left.</p></div>
        <div class="version"><div class="stage light">{inline("logo/marzgah-wordmark-fa-color.svg", label="Persian wordmark")}</div><h3>Persian wordmark</h3><p>Where the gate already appears nearby, such as a page header below the app icon.</p></div>
        <div class="version"><div class="stage light">{inline("logo/marzgah-symbol-color.svg", label="Symbol")}</div><h3>Symbol</h3><p>Avatars, app icon, favicon and stamps. For 24 px and below, use the small cut.</p></div>
        <div class="version"><div class="stage dark">{inline("logo/marzgah-horizontal-reversed.svg", label="Reversed logo")}</div><h3>Reversed</h3><p>Light turquoise mark and white wordmark on Lajvard.</p></div>
        <div class="version"><div class="stage teal">{inline("logo/marzgah-horizontal-white.svg", label="White logo")}</div><h3>One colour</h3><p>White on Firuzeh or photos, black for fax, stamps and engraving.</p></div>
      </div>
    </section>

    <section id="space">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 4</p><h2>Clear space &amp; minimum size <span class="fa" lang="fa">حریم و کمینه</span></h2></div>
      <p class="lede">Keep a margin of half the doorway's width (the saffron square) clear on every side. The same distance separates the gate from the wordmark.</p>
      <div class="stage sand">{clearspace_svg()}</div>
      <div class="cols">
        <div class="card"><h3>Symbol at small sizes</h3>
          <div class="minsizes">{small_sizes}</div>
          <p class="muted">At 24 px and below, use the small cut (<code>marzgah-symbol-small</code>). It drops the frame channel and widens the door.</p></div>
        <div class="card"><h3>Minimums</h3>
          <div class="table-wrap"><table>
            <tr><th>Version</th><th>Screen</th><th>Print</th></tr>
            <tr><td>Horizontal</td><td class="num">120 px wide</td><td class="num">30 mm</td></tr>
            <tr><td>Stacked</td><td class="num">72 px wide</td><td class="num">18 mm</td></tr>
            <tr><td>Symbol</td><td class="num">16 px (small cut)</td><td class="num">5 mm</td></tr>
            <tr><td>Persian wordmark</td><td class="num">18 px tall</td><td class="num">5 mm</td></tr>
          </table></div></div>
      </div>
    </section>

    <section id="colour">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 5</p><h2>Colour <span class="fa" lang="fa">رنگ</span></h2></div>
      <p class="lede">Turquoise and lapis are the colours of Isfahan's domes. They give Marzgah a Persian palette that stands apart from the electric blues used by most VPN brands.</p>
      <div class="ratio" aria-label="Colour proportions">
        <span style="background:var(--kahgel)"></span><span style="background:var(--lajvard)"></span><span style="background:var(--firuzeh)"></span><span style="background:var(--saffron)"></span><span style="background:var(--anar)"></span>
      </div>
      <p class="footnote">Proportion of use: mostly Kahgel and white, then Lajvard, then Firuzeh, with Za'feran and Anar as small accents.</p>
      <div class="swatches">{swatches()}</div>
      <div class="card"><h3>Accessibility</h3>
        <ul class="rules">
          <li>Body text and buttons on light grounds use <b>Firuzeh Deep</b> (6.0 : 1 on white). Plain Firuzeh (3.6 : 1) is only for the mark, icons and large display type.</li>
          <li>On Lajvard, use <b>Firuzeh Light</b> <code>{K.FIRUZEH_LIGHT}</code> (6.6 : 1) or white.</li>
          <li>Za'feran never carries white text. Put Lajvard text on it, or use it on Lajvard.</li>
          <li>Never use colour alone to show status. Pair it with a word or an icon, such as <span lang="fa" class="fa">منقضی</span> next to Anar.</li>
        </ul></div>
      <p class="footnote">* Pantone references are the nearest matches. Check them against a physical swatch book before printing.</p>
    </section>

    <section id="type">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 6</p><h2>Typography <span class="fa" lang="fa">حروف‌نگاری</span></h2></div>
      <p class="lede">Arad sets all Persian text, from the wordmark to table cells. Poppins is its Latin partner and appears only where Latin text is the main content. Both are under the SIL Open Font License.</p>
      <div class="cols">
        <div class="card specimen spec-fa"><p class="eyebrow" style="text-align:left;direction:ltr">Persian · Arad (variable 100–900)</p>
          <p class="d">گذر امن از مرز</p>
          <p class="b">نمایندگان، مشتریان خود را از یک پنل مدیریت می‌کنند؛ تمدید، گزارش فروش و کیف پول در یک جا.</p>
          <div class="weights" style="justify-content:flex-end"><span style="font-weight:300">نازک</span><span style="font-weight:400">معمولی</span><span style="font-weight:600">نیم‌پررنگ</span><span style="font-weight:850">سیاه</span></div></div>
        <div class="card specimen spec-en"><p class="eyebrow">Latin · Poppins (400, 500, 600)</p>
          <p class="d">Safe passage at the border</p>
          <p>Resellers manage their customers from one panel: renewals, sales reports and a prepaid wallet in one place.</p>
          <div class="weights"><span style="font-weight:400">Regular</span><span style="font-weight:500">Medium</span><span style="font-weight:600">SemiBold</span></div></div>
      </div>
      <div class="card"><h3>Scale</h3>
        <div class="scale-row"><span>Display 40/48</span><span class="rtl" style="font-size:2.5rem;font-weight:850">مرزگاه</span></div>
        <div class="scale-row"><span>Heading 24/32</span><span class="rtl" style="font-size:1.5rem;font-weight:700">گزارش فروش این ماه</span></div>
        <div class="scale-row"><span>Body 15/26</span><span class="rtl" style="font-size:.95rem">اشتراک شما ۱۲ روز دیگر تمام می‌شود.</span></div>
        <div class="scale-row"><span>Caption 12/18</span><span class="rtl" style="font-size:.75rem;color:var(--muted)">آخرین به‌روزرسانی: ۵ آبان ۱۴۰۵</span></div>
      </div>
      <div class="card"><h3>Persian and RTL rules</h3>
        <ul class="rules">
          <li>Use the half-space (ZWNJ) properly: <span class="rtl">می‌شود، نماینده‌ها، به‌روزرسانی</span>. Never use a full space or join the parts.</li>
          <li>Use Persian digits (<span class="rtl">۰۱۲۳۴۵۶۷۸۹</span>) in Persian text, prices and dates. Use Latin digits only in links, tokens, IPs and code.</li>
          <li>Use the Solar Hijri calendar in Persian interfaces, and set amounts in toman with a thousands separator: <span class="rtl">۱۲۰٬۰۰۰ تومان</span>.</li>
          <li>Never letter-space Persian, and never set it in Poppins or any font that lacks proper Persian joining.</li>
          <li>Mirror the layout and directional icons in RTL. Don't mirror the logo, the symbol or icons for real objects.</li>
        </ul></div>
    </section>

    <section id="pattern">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 7</p><h2>Pattern &amp; graphic elements <span class="fa" lang="fa">نقش</span></h2></div>
      <p class="lede">The arcade pattern repeats the doorway across a caravanserai wall. Always use it tone on tone, quiet enough that text can sit on top of it.</p>
      <div class="patterns">
        <div class="pat" style="background-image:url({pattern_sand});background-color:var(--kahgel);color:#16294A">Arcade on Kahgel</div>
        <div class="pat" style="background-image:url({pattern_laj});background-color:var(--lajvard);color:#fff">Arcade on Lajvard</div>
        <div class="pat" style="background-image:url({pattern_fir});background-color:var(--firuzeh);color:#fff">Arcade on Firuzeh</div>
      </div>
      <div class="cols">
        <div class="card"><h3>The border line</h3><div class="marz"><i></i><b></b><i></i></div>
          <p class="muted">A 3 px rule broken by a small gate. Use it to divide chapters, as on the pages of this book, and as an empty-state illustration.</p></div>
        <div class="card"><h3>Icons</h3>
          <p class="muted">The panel uses Lucide line icons at 1.5–2 px stroke with rounded joins. Keep icons in currentColor and never in Firuzeh outlines next to the logo. The gate is the only filled shape on the screen.</p></div>
        <div class="card"><h3>Corners</h3>
          <p class="muted">The mark is square-cornered. Interface radii stay small (8–12 px) so that cards don't fight the hard architecture of the gate.</p></div>
      </div>
    </section>

    <section id="apps">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 8</p><h2>In use <span class="fa" lang="fa">کاربرد</span></h2></div>
      <div class="apps">
        <figure class="app" style="margin:0"><div class="app-art" style="background:var(--sunk)">
          <div class="ui"><div class="ui-side">
            <div class="ui-brand"><span class="ui-tile">{inline("logo/marzgah-symbol-small-white.svg")}</span><span><b>مرزگاه</b><small>پنل نماینده</small></span></div>
            <div class="ui-item on">داشبورد</div><div class="ui-item">مشتریان</div><div class="ui-item">کیف پول</div><div class="ui-item">گزارش فروش</div>
          </div></div></div><figcaption>Panel sidebar: the small symbol on a Lajvard tile above the role label.</figcaption></figure>
        <figure class="app" style="margin:0"><div class="app-art" style="background:var(--kahgel) url({pattern_sand}) repeat;background-size:72px">
          <div class="ui"><div class="ui-card">
            <div class="lock">{inline("logo/marzgah-stacked-color.svg")}</div>
            <div class="ui-field">ایمیل</div><div class="ui-field">رمز عبور</div><div class="ui-btn">ورود به مرزگاه</div>
          </div></div></div><figcaption>Login: the stacked logo on a Kahgel arcade ground.</figcaption></figure>
        <figure class="app" style="margin:0"><div class="app-art" style="background:var(--sunk)">
          <div class="ui"><div class="ui-sub">
            <header>{inline("logo/marzgah-horizontal-white.svg")}<span class="ui-pill">۵ روز مانده</span></header>
            <div class="body">
              <div class="ui-row"><b>مصرف این دوره</b><span>۳۱ از ۵۰ گیگابایت</span></div>
              <div class="ui-bar"><i></i></div>
              <div class="ui-row"><span>تاریخ پایان</span><span>۱۰ آبان ۱۴۰۵</span></div>
              <div class="ui-btn">درخواست تمدید</div>
            </div></div></div></div><figcaption>Customer page: the white logo on a Lajvard header, with Za'feran for the one thing that needs attention.</figcaption></figure>
        <figure class="app" style="margin:0"><div class="app-art" style="background:var(--sunk);gap:14px">
          <div class="tg"><span class="av">{app_icon}</span><span><b>ربات مرزگاه</b><small>اعلان تمدید و فروش</small></span></div>
          <div style="width:96px">{app_icon}</div>
          </div><figcaption>Telegram bot avatar and app icon: the light turquoise gate on Lajvard.</figcaption></figure>
      </div>
    </section>

    <section id="voice">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 9</p><h2>Voice <span class="fa" lang="fa">لحن</span></h2></div>
      <p class="lede">Write like a polite gatekeeper: brief, exact and respectful. Use formal-friendly Persian (<span lang="fa" class="fa">شما</span>, not <span lang="fa" class="fa">تو</span>). Use no exclamation marks, no scare tactics and no technical jargon with customers.</p>
      <div class="voice">
        <div class="say yes"><span class="tag">Say</span><q>اشتراک شما ۵ روز دیگر تمام می‌شود. برای تمدید، دکمه‌ی زیر را بزنید.</q></div>
        <div class="say no"><span class="tag">Don't say</span><q>!!! هشدار: اکانتت داره منقضی میشه، سریع تمدید کن</q></div>
        <div class="say yes"><span class="tag">Say</span><q>موجودی کیف پول کافی نیست. ۲۰۰٬۰۰۰ تومان شارژ کنید تا فروش ادامه پیدا کند.</q></div>
        <div class="say no"><span class="tag">Don't say</span><q>خطای ۴۰۲: Insufficient balance</q></div>
      </div>
    </section>

    <section id="misuse">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 10</p><h2>Misuse <span class="fa" lang="fa">استفاده‌ی نادرست</span></h2></div>
      <div class="donts">{misuse()}</div>
      <p class="footnote">Also avoid shadows, gradients, outlines, animation that bends the gate, and putting the logo inside another shape (except the app-icon tile).</p>
    </section>

    <section id="files">
      <div class="marz"><i></i><b></b><i></i></div>
      <div class="sec-head"><p class="eyebrow">Chapter 11</p><h2>Files <span class="fa" lang="fa">فایل‌ها</span></h2></div>
      <p class="lede">All artwork is in the repository under <code>brand/</code>. SVG is the master format. Every logo exists in four colourways: <code>color</code>, <code>reversed</code>, <code>black</code> and <code>white</code>.</p>
      <div class="files">
        <div class="card"><code>brand/logo/</code><span class="muted">Horizontal, Latin horizontal, stacked, Persian wordmark, symbol and small symbol as SVG.</span></div>
        <div class="card"><code>brand/png/</code><span class="muted">1200 px transparent PNGs of every logo SVG.</span></div>
        <div class="card"><code>brand/web/</code><span class="muted">favicon.ico, favicon.svg, PNG icons, apple-touch-icon, maskable icon, site.webmanifest and a &lt;head&gt; snippet.</span></div>
        <div class="card"><code>brand/pattern/</code><span class="muted">Arcade pattern tiles in Kahgel, Lajvard and Firuzeh.</span></div>
        <div class="card"><code>brand/presentation/</code><span class="muted">The identity presentation board and slides with mockups.</span></div>
        <div class="card"><code>brand/build_kit.py</code><span class="muted">Regenerates every file from the geometry. Change the numbers there, never in exported files.</span></div>
      </div>
    </section>
  </main>
</div>
<footer><div><span>Marzgah · <span lang="fa" class="fa">مرزگاه</span> Brandbook 1.0</span><span>Arad and Poppins are under the SIL Open Font License. Run a trademark search before registering the mark.</span></div></footer>
'''


if __name__ == "__main__":
    K.main()
    (ROOT / "brandbook.html").write_text(page())
    print("brandbook ok", round((ROOT / "brandbook.html").stat().st_size / 1024), "KB")
