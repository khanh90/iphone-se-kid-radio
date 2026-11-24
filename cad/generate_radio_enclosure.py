#!/usr/bin/env python3
"""
Parametric 3D CAD Generator for iPhone SE (2nd/3rd Gen) Kid's Radio Enclosure.

Dimensions calibrated directly from user's `export.3mf` (iPhone SE case):
  - Phone inner cavity: 138.80 mm x 67.70 mm (0.20 mm print clearance per side)
  - Phone thickness: 7.30 mm (cavity depth 7.60 mm)
  - Side button centers (from export.3mf):
      * Z_center = 3.65 mm from screen/back midpoint
      * Volume - : X = +21.5 mm (top edge in landscape)
      * Volume + : X = +34.5 mm (top edge in landscape)
      * Power    : X = +34.5 mm (bottom edge in landscape, recessed flush)
      * Lightning: Y = 0.0 mm (left edge in landscape)
      * Speaker  : Y = -17.65 mm (left edge in landscape -> front acoustic horn)
  - Active 4.7" display (104.0 mm x 58.5 mm, centered at X=0, Y=0):
      * Top Display Window : X in [-48.0, +48.0], Y in [-3.0, +25.5]
      * 4 Touch Cutouts    : Y in [-25.5, -7.5], width 19.0 mm each
          - PREV    : X_center = -36.0 mm
          - PLAY    : X_center = -12.0 mm
          - NEXT    : X_center = +12.0 mm
          - CHANNEL : X_center = +36.0 mm
"""

import json
import math
import os
import zipfile
import xml.etree.ElementTree as ET
import numpy as np
import manifold3d as m3d
import trimesh

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
os.makedirs(OUT_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Parametric Dimensions (mm)
# ---------------------------------------------------------------------------
# Outer radio body (centered around screen X=0, Y=0; slightly wider on left for speaker)
BODY_X_MIN = -82.0
BODY_X_MAX = 75.0
BODY_W = BODY_X_MAX - BODY_X_MIN  # 157.0 mm
BODY_CX = (BODY_X_MIN + BODY_X_MAX) / 2.0  # -3.5 mm
BODY_H = 80.0                     # Y in [-40.0, +40.0]
BODY_R = 11.0                     # Outer corner radius
FRONT_WALL = 1.6                  # Front screen mask thickness (Z = 0 .. 1.6)
FRONT_BODY_Z = 19.0               # Front shell total Z depth
BACK_COVER_THICK = 3.0            # Back cover plate thickness (Z = 19.0 .. 22.0)
TOTAL_Z = FRONT_BODY_Z + BACK_COVER_THICK  # 22.0 mm

# iPhone SE inner cavity (directly matched to export.3mf)
CAVITY_W = 138.8                  # X in [-69.4, +69.4]
CAVITY_H = 67.7                   # Y in [-33.85, +33.85]
CAVITY_R = 10.2                   # Inner corner radius
CAVITY_Z0 = FRONT_WALL            # 1.6 mm (screen glass touches here)
CAVITY_Z1 = FRONT_WALL + 7.6      # 9.2 mm (phone is 7.3 mm thick)
BTN_Z_MID = FRONT_WALL + 3.65     # 5.25 mm (exact button centerline)

# Active screen coordinates (4.7" 16:9 landscape = 104.0 x 58.5 mm)
SCREEN_W = 104.0
SCREEN_H = 58.5

# Front Display Window
DISP_X0, DISP_X1 = -48.0, 48.0    # 96.0 mm wide
DISP_Y0, DISP_Y1 = -3.0, 25.5     # 28.5 mm tall
DISP_R = 4.0

# 4 Touch Button Cutouts
BTN_TOUCH_CENTERS_X = [-36.0, -12.0, 12.0, 36.0]
BTN_TOUCH_W = 19.0
BTN_TOUCH_H = 18.0
BTN_TOUCH_CY = -16.5              # Y in [-25.5, -7.5]
BTN_TOUCH_R = 4.5

# Physical side button X positions (from export.3mf)
VOL_MINUS_X = 21.5
VOL_PLUS_X = 34.5
POWER_X = 34.5

# iPhone SE Home Button (Touch ID) exact center & circular finger cutout
# Bottom edge of phone is at X = -69.2 mm; Home center is 8.6 mm from bottom edge -> X = -60.6 mm
HOME_X = -60.6
HOME_Y = 0.0
HOME_DIA = 12.4                   # Inner cutout diameter (Touch ID ring is 10.5 mm)
HOME_CHAMFER = 1.2                # 45-degree finger bevel on front face (outer dia 14.8 mm)

# Snap-fit parameters
SNAP_XS = [-42.0, 2.0]            # 2 on top wall, 2 on bottom wall (clear of buttons!)
CLEARANCE = 0.25                  # Printer tolerance for snap-fit cover


# ---------------------------------------------------------------------------
# Geometry Helpers (Manifold3D)
# ---------------------------------------------------------------------------
def rounded_rect_polygon(w: float, h: float, r: float, segments: int = 12,
                         cx: float = 0.0, cy: float = 0.0) -> list:
    """Return 2D CCW polygon points for a rounded rectangle."""
    r = min(r, w / 2.0 - 1e-4, h / 2.0 - 1e-4)
    hw, hh = w / 2.0, h / 2.0
    corners = [
        (cx + hw - r, cy + hh - r, 0.0, math.pi / 2.0),
        (cx - hw + r, cy + hh - r, math.pi / 2.0, math.pi),
        (cx - hw + r, cy - hh + r, math.pi, 3.0 * math.pi / 2.0),
        (cx + hw - r, cy - hh + r, 3.0 * math.pi / 2.0, 2.0 * math.pi),
    ]
    pts = []
    for x0, y0, a0, a1 in corners:
        for i in range(segments + 1):
            a = a0 + (a1 - a0) * (i / segments)
            pts.append([x0 + r * math.cos(a), y0 + r * math.sin(a)])
    return pts


def rounded_box(w: float, h: float, z0: float, z1: float, r: float,
                cx: float = 0.0, cy: float = 0.0, segments: int = 12) -> m3d.Manifold:
    """Extrude a rounded rectangle from z0 to z1."""
    poly = rounded_rect_polygon(w, h, r, segments=segments, cx=cx, cy=cy)
    cs = m3d.CrossSection([poly])
    return m3d.Manifold.extrude(cs, z1 - z0).translate([0.0, 0.0, z0])


def chamfered_cutout(w: float, h: float, z0: float, z1: float, r: float,
                     chamfer: float = 1.0, cx: float = 0.0, cy: float = 0.0) -> m3d.Manifold:
    """Create a through-cutout with a 45-degree finger chamfer on the z0 (front) face."""
    straight = rounded_box(w, h, z0 - 0.1, z1 + 0.1, r, cx=cx, cy=cy)
    # Stepped/lofted chamfer on the front face (z0 to z0 + chamfer)
    # Use a scaled hull of two thin rounded plates
    p_front = rounded_box(w + 2 * chamfer, h + 2 * chamfer, z0 - 0.1, z0 + 0.02,
                          r + chamfer * 0.8, cx=cx, cy=cy)
    p_inner = rounded_box(w, h, z0 + chamfer - 0.02, z0 + chamfer + 0.02,
                          r, cx=cx, cy=cy)
    bevel = m3d.Manifold.hull(p_front + p_inner)
    return straight + bevel


def box(x0: float, x1: float, y0: float, y1: float, z0: float, z1: float) -> m3d.Manifold:
    """Axis-aligned box."""
    return m3d.Manifold.cube([x1 - x0, y1 - y0, z1 - z0]).translate([x0, y0, z0])


def manifold_to_trimesh(m: m3d.Manifold) -> trimesh.Trimesh:
    mesh = m.to_mesh()
    verts = np.array(mesh.vert_properties[:, :3], dtype=np.float64)
    tris = np.array(mesh.tri_verts, dtype=np.int64)
    tm = trimesh.Trimesh(vertices=verts, faces=tris, process=False)
    return tm


# ---------------------------------------------------------------------------
# Part 1: Front Radio Shell (`01_front_body`)
# ---------------------------------------------------------------------------
def build_front_body() -> m3d.Manifold:
    # 1. Outer rounded shell (Z = 0 .. FRONT_BODY_Z) with subtle front edge chamfer
    outer_main = rounded_box(BODY_W, BODY_H, 1.0, FRONT_BODY_Z, BODY_R, cx=BODY_CX, cy=0.0)
    outer_front = rounded_box(BODY_W - 2.0, BODY_H - 2.0, 0.0, 0.05, BODY_R - 1.0, cx=BODY_CX, cy=0.0)
    outer_mid = rounded_box(BODY_W, BODY_H, 0.98, 1.05, BODY_R, cx=BODY_CX, cy=0.0)
    outer = outer_main + m3d.Manifold.hull(outer_front + outer_mid)

    # 2. Inner cavity for iPhone SE (Z = CAVITY_Z0 .. FRONT_BODY_Z + 1)
    phone_cav = rounded_box(CAVITY_W, CAVITY_H, CAVITY_Z0, FRONT_BODY_Z + 1.0, CAVITY_R, cx=0.0, cy=0.0)

    # 3. Rear step recess for back cover perimeter flange (Z = 10.2 .. FRONT_BODY_Z + 1)
    # Inner opening is 3.2 mm inset from outer wall all around (phone cavity walls hold phone from Z=1.6..10.2)
    rear_cav = rounded_box(BODY_W - 6.4, BODY_H - 6.4, 10.2, FRONT_BODY_Z + 1.0,
                           BODY_R - 3.2, cx=BODY_CX, cy=0.0)

    body = outer - phone_cav - rear_cav

    # 4. Front Screen Mask Cutouts (Display Window + 4 Tactile Touch Buttons)
    disp_w = DISP_X1 - DISP_X0
    disp_h = DISP_Y1 - DISP_Y0
    disp_cx = (DISP_X0 + DISP_X1) / 2.0
    disp_cy = (DISP_Y0 + DISP_Y1) / 2.0
    disp_cut = chamfered_cutout(disp_w, disp_h, 0.0, FRONT_WALL + 0.5, DISP_R,
                                chamfer=1.0, cx=disp_cx, cy=disp_cy)
    body = body - disp_cut

    for bx in BTN_TOUCH_CENTERS_X:
        btn_cut = chamfered_cutout(BTN_TOUCH_W, BTN_TOUCH_H, 0.0, FRONT_WALL + 0.5,
                                   BTN_TOUCH_R, chamfer=1.2, cx=bx, cy=BTN_TOUCH_CY)
        body = body - btn_cut

    # 5. Retro Front Speaker Grille & Internal Acoustic Waveguide
    # iPhone bottom speaker sits at X = -69.4, Y in [-25.4, -9.9], Z in [2.2, 8.2].
    # Carve internal acoustic chamber on the left side (X in [-78.5, -69.5], Y in [-26.0, +22.0], Z in [1.6, 11.5])
    acoustic_chamber = rounded_box(9.0, 48.0, FRONT_WALL, 11.5, 3.0, cx=-74.0, cy=-2.0)
    # Connect chamber to iPhone bottom speaker mouth
    speaker_mouth = box(-71.0, -68.0, -26.0, -9.0, 2.0, 8.8)
    body = body - acoustic_chamber - speaker_mouth

    # 7 horizontal retro speaker through-slots cleanly to the left of the Home button (X in [-77.5, -70.5])
    for i in range(7):
        sy = -21.0 + i * 7.0
        through_slot = rounded_box(7.0, 2.6, -0.2, FRONT_WALL + 0.4, 1.2, cx=-74.0, cy=sy)
        body = body - through_slot

    # 5b. Circular Chamfered Cutout for iPhone SE Home Button (Touch ID) at (-60.6, 0.0)
    home_r = HOME_DIA / 2.0
    home_straight = m3d.Manifold.cylinder(
        FRONT_WALL + 0.6, home_r, home_r, circular_segments=48
    ).translate([HOME_X, HOME_Y, -0.1])
    home_bevel = m3d.Manifold.cylinder(
        HOME_CHAMFER + 0.1, home_r + HOME_CHAMFER, home_r, circular_segments=48
    ).translate([HOME_X, HOME_Y, -0.1])
    body = body - home_straight - home_bevel

    # 6. Lightning Charging Port Cutout on Left Wall (X = -82.0 .. -68.5, Y = 0, Z = 1.6 .. 9.1)
    # Rounded stadium shape so Lightning cable plugs in cleanly without opening box
    chg_outer = rounded_box(15.0, 14.0, 1.8, 9.2, 3.2, cx=-75.5, cy=0.0)
    # Wait: rotate/orient on left wall: we want width along Y (13.6 mm) and height along Z (7.4 mm)
    # Let's build a clean rounded stadium extruded along X!
    chg_poly = rounded_rect_polygon(13.6, 7.4, 3.2, segments=10, cx=0.0, cy=BTN_Z_MID)
    chg_cut = m3d.Manifold.extrude(m3d.CrossSection([chg_poly]), 16.0)
    # Rotate so extrusion axis (Z) becomes X, and 2D (X, Y) becomes (Y, Z)
    chg_cut = chg_cut.rotate([90.0, 0.0, 0.0]).rotate([0.0, 0.0, 90.0]).translate([-83.0, 0.0, 0.0])
    body = body - chg_cut

    # 7. Synchronized Physical Side Button Slots (with inner flange retention pockets!)
    def cut_side_button_slot(bx: float, is_top: bool):
        nonlocal body
        # Outer stem slot: 9.0 mm wide (X) x 4.4 mm tall (Z)
        # Inner flange pocket: 11.6 mm wide (X) x 6.4 mm tall (Z), 2.4 mm deep from cavity wall
        if is_top:
            y_cav = CAVITY_H / 2.0      # +33.85
            y_out = BODY_H / 2.0        # +40.0
            stem_slot = box(bx - 4.5, bx + 4.5, y_cav - 0.5, y_out + 0.5,
                            BTN_Z_MID - 2.2, BTN_Z_MID + 2.2)
            flange_pocket = box(bx - 5.8, bx + 5.8, y_cav - 0.5, y_cav + 2.4,
                                BTN_Z_MID - 3.2, BTN_Z_MID + 3.2)
        else:
            y_cav = -CAVITY_H / 2.0     # -33.85
            y_out = -BODY_H / 2.0       # -40.0
            stem_slot = box(bx - 4.5, bx + 4.5, y_out - 0.5, y_cav + 0.5,
                            BTN_Z_MID - 2.2, BTN_Z_MID + 2.2)
            flange_pocket = box(bx - 5.8, bx + 5.8, y_cav - 2.4, y_cav + 0.5,
                                BTN_Z_MID - 3.2, BTN_Z_MID + 3.2)
        body = body - stem_slot - flange_pocket

    cut_side_button_slot(VOL_MINUS_X, is_top=True)
    cut_side_button_slot(VOL_PLUS_X, is_top=True)
    cut_side_button_slot(POWER_X, is_top=False)

    # 8. Snap-Fit Detent Pockets on Top & Bottom Inner Walls (for Back Cover clips!)
    # Outer wall at top is Y in [36.8, 40.0] (3.2 mm thick); bottom is Y in [-40.0, -36.8].
    # Carve 1.4 mm deep detent pockets at Z in [11.5, 14.5] (leaving 1.8 mm solid outer wall!)
    for sx in SNAP_XS:
        top_detent = box(sx - 6.0, sx + 6.0, BODY_H / 2.0 - 3.4, BODY_H / 2.0 - 1.8, 11.5, 14.5)
        bot_detent = box(sx - 6.0, sx + 6.0, -BODY_H / 2.0 + 1.8, -BODY_H / 2.0 + 3.4, 11.5, 14.5)
        body = body - top_detent - bot_detent

    # 9. Parent Pry Notches on Back Rim (2 small slots on top/bottom rear edge for coin/tool)
    pry_left = box(-55.0, -45.0, BODY_H / 2.0 - 3.5, BODY_H / 2.0 + 0.5, FRONT_BODY_Z - 1.8, FRONT_BODY_Z + 0.5)
    body = body - pry_left

    return body


# ---------------------------------------------------------------------------
# Part 2: Snap-Fit Back Cover (`02_back_cover`)
# ---------------------------------------------------------------------------
def build_back_cover() -> m3d.Manifold:
    # Build in assembled position first (Z = 19.0 .. 22.0, clips going forward to Z = 12.5),
    # then flip/translate to print flat on build plate (Z = 0 at back outer face)!

    # 1. Outer back plate with chamfered back edge
    plate_inner = rounded_box(BODY_W, BODY_H, FRONT_BODY_Z, TOTAL_Z - 1.0, BODY_R, cx=BODY_CX, cy=0.0)
    plate_mid = rounded_box(BODY_W, BODY_H, TOTAL_Z - 1.02, TOTAL_Z - 0.95, BODY_R, cx=BODY_CX, cy=0.0)
    plate_back = rounded_box(BODY_W - 2.0, BODY_H - 2.0, TOTAL_Z - 0.05, TOTAL_Z, BODY_R - 1.0, cx=BODY_CX, cy=0.0)
    cover = plate_inner + m3d.Manifold.hull(plate_mid + plate_back)

    # 2. Inner perimeter alignment lip (fits inside rear_cav of front_body with CLEARANCE)
    lip_w = BODY_W - 6.4 - 2 * CLEARANCE
    lip_h = BODY_H - 6.4 - 2 * CLEARANCE
    lip_outer = rounded_box(lip_w, lip_h, 15.2, FRONT_BODY_Z + 0.2, BODY_R - 3.2 - CLEARANCE, cx=BODY_CX, cy=0.0)
    lip_inner = rounded_box(lip_w - 4.0, lip_h - 4.0, 14.8, FRONT_BODY_Z + 0.5, BODY_R - 5.2, cx=BODY_CX, cy=0.0)
    lip = lip_outer - lip_inner
    # Cut relief gaps in the lip around each cantilever snap hook so the hooks flex freely!
    for sx in SNAP_XS:
        gap_top = box(sx - 7.5, sx + 7.5, BODY_H / 2.0 - 7.0, BODY_H / 2.0, 14.5, FRONT_BODY_Z + 0.3)
        gap_bot = box(sx - 7.5, sx + 7.5, -BODY_H / 2.0, -BODY_H / 2.0 + 7.0, 14.5, FRONT_BODY_Z + 0.3)
        lip = lip - gap_top - gap_bot
    cover = cover + lip

    # 3. 4 Flexible Cantilever Snap-Fit Hooks (engaging detent pockets at Z = 11.5..14.5)
    for sx in SNAP_XS:
        for sign in (+1.0, -1.0):
            y_wall = sign * (BODY_H / 2.0 - 3.2 - CLEARANCE)
            # Freestanding flexible arm stem (1.6 mm thick, 9.6 mm wide, Z = 11.4 .. 19.2)
            if sign > 0:
                arm = box(sx - 4.8, sx + 4.8, y_wall - 1.8, y_wall - 0.2, 11.4, FRONT_BODY_Z + 0.3)
                # Ramped barb protruding outward by 1.05 mm at Z = 12.2 .. 14.2
                b0 = box(sx - 4.8, sx + 4.8, y_wall - 0.3, y_wall + 0.0, 11.4, 11.5)
                b1 = box(sx - 4.8, sx + 4.8, y_wall - 0.3, y_wall + 1.05, 12.6, 14.2)
                barb = m3d.Manifold.hull(b0 + b1)
            else:
                arm = box(sx - 4.8, sx + 4.8, y_wall + 0.2, y_wall + 1.8, 11.4, FRONT_BODY_Z + 0.3)
                b0 = box(sx - 4.8, sx + 4.8, y_wall - 0.0, y_wall + 0.3, 11.4, 11.5)
                b1 = box(sx - 4.8, sx + 4.8, y_wall - 1.05, y_wall + 0.3, 12.6, 14.2)
                barb = m3d.Manifold.hull(b0 + b1)
            cover = cover + arm + barb

    # 4. Internal Phone-Retention Pressure Ribs (keeps iPhone SE flush at Z = 1.6..9.1 mm!)
    # Avoids rear camera bump zone (X > +40, Y > +10)
    rib_positions = [
        (-45.0, -20.0, 20.0),   # Left rib
        (0.0,   -20.0, 20.0),   # Center rib
        (32.0,  -20.0, 8.0),    # Right rib (stops below camera bump!)
    ]
    for rx, ry0, ry1 in rib_positions:
        rib = rounded_box(4.0, ry1 - ry0, CAVITY_Z1 + 0.1, FRONT_BODY_Z + 0.2, 1.5,
                          cx=rx, cy=(ry0 + ry1) / 2.0)
        cover = cover + rib

    # 5. Decorative Ventilation Slots on Back Cover (heat dissipation while charging)
    for i in range(6):
        vx = -30.0 + i * 10.0
        vent = rounded_box(3.0, 28.0, FRONT_BODY_Z - 0.5, TOTAL_Z + 0.5, 1.4, cx=vx, cy=0.0)
        cover = cover - vent

    # Flip upside down so outer back face sits flat at Z = 0 for support-free printing!
    cover_print = cover.rotate([180.0, 0.0, 0.0]).translate([0.0, 0.0, TOTAL_Z])
    return cover_print


# ---------------------------------------------------------------------------
# Parts 3, 4, 5: Synchronized Physical Button Plungers
# ---------------------------------------------------------------------------
def build_button_plunger(protrusion: float = 2.4, tactile_mark: str = "minus") -> m3d.Manifold:
    """
    Build a captive-flange button plunger, oriented upright for support-free 3D printing
    (flange flat on build plate at Z = 0, stem pointing +Z).
    Wall depth from phone cavity (33.85) to outer wall (40.0) = 6.15 mm.
    Flange sits in inner pocket (0 .. 1.6 mm), stem passes through outer wall (1.6 .. 6.15 + protrusion).
    """
    wall_depth = (BODY_H - CAVITY_H) / 2.0  # 6.15 mm
    # Base flange (10.8 x 5.6 mm, 1.5 mm thick) - fits inside 11.6 x 6.4 mm pocket!
    flange = rounded_box(10.8, 5.6, 0.0, 1.5, 1.2)
    # Small inner nub on bottom? Better: keep flange flat at Z=0 for clean bed adhesion,
    # and design total height = wall_depth + protrusion with 0.2mm pre-travel!
    stem_h = wall_depth + protrusion
    stem = rounded_box(8.3, 3.7, 1.2, stem_h - 0.6, 1.2)
    # Rounded cap on top of stem
    cap_base = rounded_box(8.3, 3.7, stem_h - 0.65, stem_h - 0.55, 1.2)
    cap_top = rounded_box(6.8, 2.4, stem_h - 0.05, stem_h, 0.9)
    cap = m3d.Manifold.hull(cap_base + cap_top)
    btn = flange + stem + cap

    # Tactile indicator on top surface so child/parent can feel Vol+ vs Vol-
    if tactile_mark == "plus":
        bar1 = rounded_box(4.2, 0.9, stem_h - 0.1, stem_h + 0.55, 0.4)
        bar2 = rounded_box(0.9, 2.0, stem_h - 0.1, stem_h + 0.55, 0.4)
        btn = btn + bar1 + bar2
    elif tactile_mark == "minus":
        bar1 = rounded_box(4.2, 0.9, stem_h - 0.1, stem_h + 0.55, 0.4)
        btn = btn + bar1
    return btn


# ---------------------------------------------------------------------------
# Export 3MF (Bambu Studio / PrusaSlicer compatible)
# ---------------------------------------------------------------------------
def export_combined_3mf(parts_named: list, out_path: str):
    """Write a clean standard 3MF archive containing all parts arranged on one build plate."""
    # Build plate layout offsets (mm)
    layout = {
        "01_front_body":       (110.0, 175.0, 0.0),
        "02_back_cover":       (110.0, 82.0,  0.0),
        "03_button_vol_minus": (50.0,  25.0,  0.0),
        "04_button_vol_plus":  (80.0,  25.0,  0.0),
        "05_button_power":     (110.0, 25.0,  0.0),
    }

    ns = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
    ET.register_namespace("", ns)
    model = ET.Element(f"{{{ns}}}model", {"unit": "millimeter", "xml:lang": "en-US"})
    resources = ET.SubElement(model, f"{{{ns}}}resources")
    build = ET.SubElement(model, f"{{{ns}}}build")

    for idx, (name, tm) in enumerate(parts_named, start=1):
        obj = ET.SubElement(resources, f"{{{ns}}}object",
                            {"id": str(idx), "type": "model", "name": name})
        mesh_el = ET.SubElement(obj, f"{{{ns}}}mesh")
        verts_el = ET.SubElement(mesh_el, f"{{{ns}}}vertices")
        for v in tm.vertices:
            ET.SubElement(verts_el, f"{{{ns}}}vertex",
                          {"x": f"{v[0]:.4f}", "y": f"{v[1]:.4f}", "z": f"{v[2]:.4f}"})
        tris_el = ET.SubElement(mesh_el, f"{{{ns}}}triangles")
        for f in tm.faces:
            ET.SubElement(tris_el, f"{{{ns}}}triangle",
                          {"v1": str(int(f[0])), "v2": str(int(f[1])), "v3": str(int(f[2]))})
        tx, ty, tz = layout.get(name, (0.0, 0.0, 0.0))
        ET.SubElement(build, f"{{{ns}}}item",
                      {"objectid": str(idx),
                       "transform": f"1 0 0 0 1 0 0 0 1 {tx:.3f} {ty:.3f} {tz:.3f}"})

    model_xml = ET.tostring(model, encoding="utf-8", xml_declaration=True)
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>'
        '</Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2015/02/3dmodel"/>'
        '</Relationships>'
    )

    with zipfile.ZipFile(out_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("3D/3dmodel.model", model_xml)


# ---------------------------------------------------------------------------
# Engineering Preview Render (Matplotlib)
# ---------------------------------------------------------------------------
def render_preview(parts_named: list, out_png: str):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from mpl_toolkits.mplot3d.art3d import Poly3DCollection

    fig = plt.figure(figsize=(14, 9), dpi=140, facecolor="#14161a")
    views = [
        ("Front Radio Face (Screen Mask & Speaker)", "01_front_body", (90, -90), "#e8b86d"),
        ("Front Shell — Inside iPhone SE Cavity",    "01_front_body", (-55, -65), "#e8b86d"),
        ("Back Cover — Snap Clips & Pressure Ribs",  "02_back_cover", (35, -50), "#6da7e8"),
        ("3D Isometric — Front Shell + Buttons",     "01_front_body", (28, -52), "#e8b86d"),
    ]
    parts_map = dict(parts_named)

    for idx, (title, pname, (elev, azim), color) in enumerate(views, start=1):
        ax = fig.add_subplot(2, 2, idx, projection="3d", facecolor="#1c1f26")
        tm = parts_map[pname]
        # Subsample if huge, though our manifold meshes are ~5k-15k faces
        faces = tm.faces
        if len(faces) > 6000:
            step = max(1, len(faces) // 6000)
            faces = faces[::step]
        polys = tm.vertices[faces]
        coll = Poly3DCollection(polys, facecolor=color, edgecolor="#22252c",
                                linewidths=0.08, alpha=0.96)
        ax.add_collection3d(coll)

        bmin, bmax = tm.bounds
        center = (bmin + bmax) / 2.0
        span = np.max(bmax - bmin) / 2.0 * 1.1
        ax.set_xlim(center[0] - span, center[0] + span)
        ax.set_ylim(center[1] - span, center[1] + span)
        ax.set_zlim(center[2] - span, center[2] + span)
        ax.view_init(elev=elev, azim=azim)
        ax.set_title(title, color="#f2f4f8", fontsize=11, pad=8, fontweight="bold")
        ax.tick_params(colors="#8b949e", labelsize=7)
        ax.set_xlabel("X (mm)", color="#8b949e", fontsize=8)
        ax.set_ylabel("Y (mm)", color="#8b949e", fontsize=8)
        ax.set_zlabel("Z (mm)", color="#8b949e", fontsize=8)

    plt.tight_layout()
    plt.savefig(out_png, facecolor=fig.get_facecolor())
    plt.close(fig)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    print("Building 01_front_body...")
    front_m = build_front_body()
    print("Building 02_back_cover...")
    back_m = build_back_cover()
    print("Building 03_button_vol_minus...")
    btn_vm_m = build_button_plunger(protrusion=2.4, tactile_mark="minus")
    print("Building 04_button_vol_plus...")
    btn_vp_m = build_button_plunger(protrusion=2.8, tactile_mark="plus")
    print("Building 05_button_power (recessed flush)...")
    btn_pw_m = build_button_plunger(protrusion=-0.3, tactile_mark="none")

    parts = [
        ("01_front_body", front_m),
        ("02_back_cover", back_m),
        ("03_button_vol_minus", btn_vm_m),
        ("04_button_vol_plus", btn_vp_m),
        ("05_button_power", btn_pw_m),
    ]

    parts_tm = []
    for name, m in parts:
        tm = manifold_to_trimesh(m)
        stl_path = os.path.join(OUT_DIR, f"{name}.stl")
        tm.export(stl_path)
        b = tm.bounds
        dims = b[1] - b[0]
        print(f"  Exported {name}.stl | watertight={tm.is_watertight} | "
              f"faces={len(tm.faces)} | size={dims[0]:.2f} x {dims[1]:.2f} x {dims[2]:.2f} mm")
        parts_tm.append((name, tm))

    threemf_path = os.path.join(OUT_DIR, "iphone_se_radio_all_parts.3mf")
    export_combined_3mf(parts_tm, threemf_path)
    print(f"Exported combined Bambu Studio plate: {threemf_path}")

    # Export exact screen-mask calibration JSON shared with the Web App!
    # Convert mm coords to % of active 104.0 x 58.5 mm screen (top-left origin for CSS!)
    def mm_to_css_rect(x0, x1, y0, y1):
        # Screen X in [-52, +52] -> left% = (x + 52) / 104 * 100
        # Screen Y in [-29.25, +29.25] -> top% = (29.25 - y) / 58.5 * 100
        return {
            "leftPct": round((x0 + SCREEN_W / 2.0) / SCREEN_W * 100.0, 3),
            "topPct": round((SCREEN_H / 2.0 - y1) / SCREEN_H * 100.0, 3),
            "widthPct": round((x1 - x0) / SCREEN_W * 100.0, 3),
            "heightPct": round((y1 - y0) / SCREEN_H * 100.0, 3),
        }

    calibration = {
        "device": "iPhone SE (2nd/3rd Gen) Landscape",
        "activeScreenMm": {"width": SCREEN_W, "height": SCREEN_H},
        "displayWindow": mm_to_css_rect(DISP_X0, DISP_X1, DISP_Y0, DISP_Y1),
        "buttons": [
            {"id": "prev",    "label": "Bài trước",  **mm_to_css_rect(BTN_TOUCH_CENTERS_X[0] - BTN_TOUCH_W / 2, BTN_TOUCH_CENTERS_X[0] + BTN_TOUCH_W / 2, BTN_TOUCH_CY - BTN_TOUCH_H / 2, BTN_TOUCH_CY + BTN_TOUCH_H / 2)},
            {"id": "play",    "label": "Phát/Dừng",  **mm_to_css_rect(BTN_TOUCH_CENTERS_X[1] - BTN_TOUCH_W / 2, BTN_TOUCH_CENTERS_X[1] + BTN_TOUCH_W / 2, BTN_TOUCH_CY - BTN_TOUCH_H / 2, BTN_TOUCH_CY + BTN_TOUCH_H / 2)},
            {"id": "next",    "label": "Bài sau",    **mm_to_css_rect(BTN_TOUCH_CENTERS_X[2] - BTN_TOUCH_W / 2, BTN_TOUCH_CENTERS_X[2] + BTN_TOUCH_W / 2, BTN_TOUCH_CY - BTN_TOUCH_H / 2, BTN_TOUCH_CY + BTN_TOUCH_H / 2)},
            {"id": "channel", "label": "Đổi kênh",   **mm_to_css_rect(BTN_TOUCH_CENTERS_X[3] - BTN_TOUCH_W / 2, BTN_TOUCH_CENTERS_X[3] + BTN_TOUCH_W / 2, BTN_TOUCH_CY - BTN_TOUCH_H / 2, BTN_TOUCH_CY + BTN_TOUCH_H / 2)},
        ],
    }
    cal_path = os.path.join(OUT_DIR, "screen_calibration.json")
    with open(cal_path, "w", encoding="utf-8") as f:
        json.dump(calibration, f, indent=2, ensure_ascii=False)
    print(f"Exported shared screen calibration: {cal_path}")

    preview_path = os.path.join(OUT_DIR, "preview_3d_views.png")
    print("Rendering 3D engineering preview...")
    render_preview(parts_tm, preview_path)
    print(f"Rendered preview: {preview_path}")


if __name__ == "__main__":
    main()
