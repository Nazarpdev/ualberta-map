"""Straight-line rebuild of the CSC Level 1 wayfinding diagram, measured wall by
wall off the source photo (fractions of the photo, then axis-aligned).

Diagram frame: x 0-900 west->east, y 0-1000 north->south (portrait, like the
photo). Review artifact: run `python tools/csc-diagram.py` and open
`tools/csc-diagram.svg` to compare against the photo. Nothing here touches
the live map; the footprint fit happens only after approval.

The ROOMS table doubles as the source for that later fitting step.
"""
from pathlib import Path

# (code, x0, y0, x1, y1, label) — straight rectangles as drawn in the photo.
ROOMS = [
    ("1-05",  10,   0, 230, 125, "1-05"),
    ("WC-M", 230,   0, 330, 125, "WC"),
    ("WC-W", 330,   0, 440, 125, "WC"),
    ("1-13", 450,   0, 620, 111, "1-13"),
    ("1-67",   0, 306, 225, 472, "1-67"),
    ("1-59",   0, 472, 225, 667, "1-59"),
    ("1-53",   0, 667, 225, 847, "1-53"),
    ("1-49",  20, 847, 220, 931, "1-49"),
    ("1-66", 340, 347, 405, 431, "1-66"),
    ("1-24", 405, 347, 470, 431, "1-24"),
    ("1-64", 340, 431, 405, 486, "1-64"),
    ("1-26", 405, 431, 470, 486, "1-26"),
    ("1-28", 340, 486, 470, 639, "1-28"),
    ("1-32", 340, 639, 470, 701, "1-32"),
    ("1-40", 340, 701, 470, 778, "1-40"),
    ("1-21", 580, 215, 795, 354, "1-21"),
    ("1-25", 580, 354, 795, 493, "1-25"),
    ("1-29", 580, 493, 795, 667, "1-29"),
    ("1-33", 580, 667, 650, 743, "1-33"),
    ("1-35", 650, 667, 720, 743, "1-35"),
    ("1-37", 720, 667, 780, 743, "1-37"),
    ("1-47", 220, 847, 460, 931, "1-47"),
    ("1-41", 460, 847, 530, 931, "1-41"),
    ("1-39", 530, 847, 590, 931, "1-39"),
]

# Elevator shaft: enclosure with chamfered top corners, icon inside.
ELEV_OUTLINE = [(350,333),(350,285),(375,264),(445,264),(470,285),(470,333)]
ELEV_ICON = (410, 299)

# Gray filler over corridor background (notch strip + blank square by 1-37).
FILLER = [
    (795, 208, 820, 667),   # notch strip east of 1-21/1-25/1-29
    (780, 667, 820, 743),   # blank square east of 1-37
]

OUTLINE = [(0,0),(820,0),(820,743),(900,743),(900,1000),(0,1000)]
# Curved jog sliver on the far west edge (kept outside the straight outline).
SLIVER = "M0,200 C-28,210 -28,270 0,282 Z"

STAIRS = [(110,257),(740,167),(570,910),(840,896)]
PHONES = [(140,208),(700,910)]

ROOM_FILL = "#585e5d"
HALL_FILL = "#b5bab5"
INK = "#222222"


def svg():
    p = lambda pts: "M" + "L".join(f"{x},{y}" for x, y in pts) + "Z"
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -80 1040 1160" font-family="system-ui,sans-serif">']
    out.append('<rect x="-70" y="-80" width="1040" height="1160" fill="white"/>')
    out.append(f'<text x="0" y="-35" font-size="34" font-weight="600" fill="{INK}">CSC Level 1 — diagram rebuild (review, not yet fitted)</text>')
    out.append(f'<path d="{p(OUTLINE)}" fill="{HALL_FILL}" stroke="{INK}" stroke-width="5"/>')
    out.append(f'<path d="{SLIVER}" fill="{HALL_FILL}" stroke="{INK}" stroke-width="3"/>')
    for x0, y0, x1, y1 in FILLER:
        out.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="{HALL_FILL}" stroke="white" stroke-width="2"/>')
    for code, x0, y0, x1, y1, label in ROOMS:
        out.append(f'<rect x="{x0}" y="{y0}" width="{x1-x0}" height="{y1-y0}" fill="{ROOM_FILL}" stroke="white" stroke-width="2"/>')
        out.append(f'<text x="{(x0+x1)/2}" y="{(y0+y1)/2}" font-size="26" fill="white" text-anchor="middle" dominant-baseline="central">{label}</text>')
    out.append(f'<path d="{p(ELEV_OUTLINE)}" fill="none" stroke="white" stroke-width="3"/>')
    ex, ey = ELEV_ICON
    out.append(f'<circle cx="{ex}" cy="{ey}" r="24" fill="{INK}"/>')
    out.append(f'<text x="{ex}" y="{ey}" font-size="22" fill="white" text-anchor="middle" dominant-baseline="central">E</text>')
    for x, y in STAIRS:
        out.append(f'<circle cx="{x}" cy="{y}" r="24" fill="{INK}"/>')
        out.append(f'<text x="{x}" y="{y}" font-size="26" fill="white" text-anchor="middle" dominant-baseline="central">S</text>')
    for x, y in PHONES:
        out.append(f'<circle cx="{x}" cy="{y}" r="14" fill="{INK}"/>')
        out.append(f'<text x="{x}" y="{y}" font-size="16" fill="white" text-anchor="middle" dominant-baseline="central">☎</text>')
    out.append(f'<text x="625" y="882" font-size="20" fill="{INK}" text-anchor="middle">Access to basement</text>')
    out.append(f'<text x="625" y="906" font-size="20" fill="{INK}" text-anchor="middle">lecture theatres ↓</text>')
    out.append(f'<text x="760" y="837" font-size="18" fill="#c0392b" text-anchor="middle">YOU ARE HERE ↑</text>')
    out.append(f'<text x="790" y="955" font-size="20" fill="{INK}" text-anchor="middle">Athabasca Hall Access →</text>')
    out.append('</svg>')
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    dest = Path(__file__).with_name("csc-diagram.svg")
    dest.write_text(svg(), encoding="utf-8")
    print(f"Wrote {dest} ({len(ROOMS)} rooms)")
