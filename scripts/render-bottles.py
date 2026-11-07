"""Rendu des bouteilles vierges de Vinicellar (Blender / Cycles, sans étiquette).

Produit, dans assets/img/bottles/ :
  {forme}-{verre}.webp    bouteille vierge, fond transparent (verre + vin, éclairage studio)
  {forme}-cap-{type}.webp capsule neutre (grise) à teinter dans le navigateur
  {forme}-sleeve.webp     éclairage d'une étiquette en papier blanc posée sur le corps et sur le col
  bottles.json            géométrie en pixels (zones d'étiquette, rayon, capsule) pour la composition

Toutes les images partagent la même caméra de packshot (85 mm, légère plongée, 1200 × 1600 px, ombre portée sur fond transparent) :
les calques se superposent au pixel près et les formes gardent leurs proportions réelles.

Usage : python scripts/render-bottles.py [--samples 96] [--only bordeaux]   (paquet pip « bpy »)
"""
import argparse, json, math, os
import bpy, bmesh, mathutils
import numpy as np
from PIL import Image

W, H = 1200, 1600                        # pixels (3:4)
# Caméra de packshot : 85 mm, légèrement plongeante (7°), visée au milieu de la bouteille, même cadrage pour toutes.
LENS, SENSOR, DIST, ELEV, TARGET_Z = 85, 24, 1.42, 7, .182
SCALE = .40; PPM = H / SCALE               # (anciens rendus orthographiques ; conservé pour la compatibilité)
PCT = 100
OUT = os.path.join(os.path.dirname(__file__), "..", "assets", "img", "bottles")

# Profils extérieurs (hauteur z, rayon) en mètres, du pied à la bague. Lissés par interpolation.
SHAPES = {
    "bordeaux": {"h": .300, "pts": [(0, .0355), (.004, .0372), (.012, .0375), (.190, .0375), (.205, .033), (.218, .022), (.228, .0160), (.240, .0146), (.286, .0145), (.288, .0162), (.299, .0162), (.300, .0150)],
                 "body": (.030, .182), "neck": (.236, .255), "fill": .238},
    "burgundy": {"h": .295, "pts": [(0, .0385), (.004, .0400), (.012, .0402), (.145, .0402), (.170, .0385), (.200, .0300), (.225, .0190), (.240, .0152), (.281, .0148), (.283, .0165), (.294, .0165), (.295, .0152)],
                 "body": (.028, .140), "neck": (.238, .252), "fill": .232},
    "champagne": {"h": .300, "pts": [(0, .0420), (.005, .0440), (.014, .0443), (.135, .0443), (.165, .0420), (.200, .0310), (.228, .0185), (.245, .0160), (.282, .0156), (.285, .0178), (.297, .0178), (.300, .0165)],
                  "body": (.030, .130), "neck": (.205, .220), "fill": .240},
    "alsace": {"h": .350, "pts": [(0, .0330), (.004, .0343), (.012, .0345), (.165, .0345), (.205, .0310), (.250, .0220), (.290, .0150), (.330, .0138), (.336, .0153), (.348, .0153), (.350, .0142)],
               "body": (.030, .160), "neck": (.290, .305), "fill": .280},
    "spirit": {"h": .285, "pts": [(0, .0400), (.004, .0418), (.012, .0420), (.200, .0420), (.212, .0395), (.222, .0300), (.230, .0200), (.238, .0172), (.270, .0170), (.272, .0182), (.284, .0182), (.285, .0170)],
               "body": (.030, .195), "neck": (.240, .258), "fill": .232},
}
# Verre (couleur de transmission) et liquide (couleur d'absorption, densité) par variante.
GLASS = {"darkgreen": (.025, .085, .035), "green": (.035, .12, .05), "olive": (.10, .09, .03), "amber": (.36, .18, .05), "flint": (.96, .97, .96)}
LIQUID = {"red": ((.28, .02, .05), 90), "white": ((.95, .82, .35), 30), "rose": ((.95, .42, .40), 40), "amber": ((.85, .42, .06), 55), "clear": ((.97, .97, .97), .5), "none": None}
VARIANTS = {
    "bordeaux": [("green", "red"), ("flint", "white"), ("flint", "rose")],
    "burgundy": [("olive", "red"), ("olive", "white"), ("flint", "white")],
    "champagne": [("darkgreen", "white"), ("flint", "rose")],
    "alsace": [("green", "white"), ("flint", "white")],
    "spirit": [("flint", "amber"), ("flint", "clear")],
}
CAPS = {"bordeaux": ["foil", "screwcap"], "burgundy": ["foil", "screwcap"], "alsace": ["foil", "screwcap"], "champagne": ["champagne"], "spirit": ["stopper"]}


def profile(pts, n=300):
    """Rayon lissé : interpolation cubique monotone (Fritsch-Carlson), sans marches entre les points."""
    z = np.array([p[0] for p in pts]); r = np.array([p[1] for p in pts])
    d = np.diff(r) / np.diff(z); m = np.zeros_like(r)
    m[1:-1] = np.where(d[:-1] * d[1:] > 0, 2 / (1 / np.where(d[:-1] == 0, 1e-9, d[:-1]) + 1 / np.where(d[1:] == 0, 1e-9, d[1:])), 0)
    m[0], m[-1] = d[0], d[-1]
    zs = np.linspace(z[0], z[-1], n); out = []
    for q in zs:
        i = min(np.searchsorted(z, q, side="right") - 1, len(z) - 2); h = z[i + 1] - z[i]; t = (q - z[i]) / h
        h00, h10, h01, h11 = 2*t**3 - 3*t**2 + 1, t**3 - 2*t**2 + t, -2*t**3 + 3*t**2, t**3 - t**2
        out.append((float(q), float(h00 * r[i] + h10 * h * m[i] + h01 * r[i + 1] + h11 * h * m[i + 1])))
    return out


def lathe(name, prof, close_bottom=True, close_top=False, segs=160):
    mesh = bpy.data.meshes.new(name); bm = bmesh.new()
    rings = []
    for z, r in prof:
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for a in np.linspace(0, 2 * math.pi, segs, endpoint=False)])
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    if close_bottom:
        c = bm.verts.new((0, 0, prof[0][0]))
        for i in range(segs): bm.faces.new((rings[0][(i + 1) % segs], rings[0][i], c))
    if close_top:
        c = bm.verts.new((0, 0, prof[-1][0]))
        for i in range(segs): bm.faces.new((rings[-1][i], rings[-1][(i + 1) % segs], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh); bm.free()
    for p in mesh.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, mesh); bpy.context.scene.collection.objects.link(ob)
    return ob


def material(name, **k):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    for key, val in k.items():
        if key in ("volume",): continue
        b.inputs[key].default_value = val
    if "volume" in k:
        color, dens = k["volume"]
        v = nt.nodes.new("ShaderNodeVolumeAbsorption"); v.inputs["Color"].default_value = (*color, 1); v.inputs["Density"].default_value = dens
        nt.links.new(v.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    return m


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
    sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, PCT
    sc.render.film_transparent = True
    sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"; sc.view_settings.exposure = 0
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces, sc.cycles.transmission_bounces, sc.cycles.glossy_bounces, sc.cycles.volume_bounces = 16, 16, 8, 2
    world = bpy.data.worlds.new("w"); sc.world = world; world.use_nodes = True
    bg = world.node_tree.nodes["Background"]; bg.inputs[0].default_value = (1, 1, 1, 1); bg.inputs[1].default_value = .55
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = LENS; cam.data.sensor_fit = "VERTICAL"; cam.data.sensor_height = SENSOR
    e = math.radians(ELEV); cam.location = (0, -DIST * math.cos(e), TARGET_Z + DIST * math.sin(e))
    cam.rotation_euler = (math.pi / 2 - e, 0, 0)
    # Studio de packshot : grande boîte à lumière à droite (ombre portée vers l'arrière gauche), réflecteur haut
    # à gauche (reflet doux et large), liseré en contre-jour à droite, lumière douce du dessus.
    def area(name, loc, size, power, target=(0, 0, .17), shadow=True):
        l = bpy.data.lights.new(name, "AREA"); l.shape = "ELLIPSE" if name == "key" else "RECTANGLE"; l.size, l.size_y = size; l.energy = power; l.use_shadow = shadow
        o = bpy.data.objects.new(name, l); o.location = loc; sc.collection.objects.link(o)
        d = mathutils.Vector(target) - mathutils.Vector(loc); o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    area("key", (1.0, -1.0, 1.1), (1.6, 1.6), 330)
    area("fill", (-1.1, -.7, .4), (.9, 2.0), 170, shadow=False)
    area("rim", (.6, .8, .35), (.3, 1.5), 90, shadow=False)
    area("top", (0, -.1, 1.3), (.9, .9), 50, shadow=False)
    return sc


def floor():
    """Sol attrape-ombre : seule l'ombre (en transparence) apparaît dans l'image."""
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0)); ob = bpy.context.object
    ob.is_shadow_catcher = True
    ob.visible_transmission = ob.visible_glossy = ob.visible_diffuse = False   # invisible à travers et dans le verre


def camera_meta():
    """Paramètres de la caméra pour reprojeter l'étiquette dans le navigateur (rayon → cylindre)."""
    sc = reset(); cam = sc.camera
    bpy.context.view_layer.update()
    R = cam.matrix_world.to_3x3()
    return {"pos": [round(v, 6) for v in cam.location], "rot": [[round(R[i][j], 6) for j in range(3)] for i in range(3)],
            "f": round(LENS / SENSOR * H, 4), "size": [W, H]}
    return sc


def render(sc, path):
    sc.render.filepath = path + ".png"; bpy.ops.render.render(write_still=True)
    im = Image.open(path + ".png"); im.save(path + ".webp", "WEBP", quality=90, method=6); os.remove(path + ".png")


def bottle(shape, glass, liquid):
    s = SHAPES[shape]; prof = profile(s["pts"])
    ob = lathe("glass", prof, close_bottom=True)
    mod = ob.modifiers.new("thick", "SOLIDIFY"); mod.thickness = .0032; mod.offset = -1
    ob.data.materials.append(material("glass", **{"Base Color": (*GLASS[glass], 1), "Transmission Weight": 1.0, "Roughness": .07, "IOR": 1.52}))
    if LIQUID[liquid]:
        inner = [(z, max(r - .0036, .001)) for z, r in prof if .005 <= z <= s["fill"]]
        lq = lathe("liquid", inner, close_bottom=True, close_top=True)
        lq.data.materials.append(material("liquid", **{"Base Color": (1, 1, 1, 1), "Transmission Weight": 1.0, "Roughness": 0, "IOR": 1.34, "volume": LIQUID[liquid]}))
    return ob


def cap(shape, kind):
    s = SHAPES[shape]; prof = profile(s["pts"]); h = s["h"]
    gray = {"Base Color": (.55, .55, .55, 1), "Metallic": .55, "Roughness": .32}
    if kind == "foil":
        p = [(z, r + .0007) for z, r in prof if z >= h - .052]
        ob = lathe("cap", p, close_bottom=False, close_top=True)
    elif kind == "screwcap":
        p = [(h - .060, prof[-1][1] + .0016), (h - .002, prof[-1][1] + .0016), (h, prof[-1][1] + .0008)]
        ob = lathe("cap", [(z, r) for z, r in p], close_bottom=False, close_top=True); gray.update({"Metallic": .9, "Roughness": .22})
    elif kind == "champagne":
        p = [(z, r + .0010) for z, r in prof if z >= h - .115] + [(h + .004, .0175), (h + .012, .0150), (h + .016, .0080)]
        ob = lathe("cap", p, close_bottom=False, close_top=True)
    else:  # bouchon à tête (spiritueux)
        p = [(h - .002, .0205), (h + .026, .0205), (h + .030, .0185)]
        ob = lathe("cap", p, close_bottom=True, close_top=True); gray.update({"Metallic": 0, "Roughness": .45})
    ob.data.materials.append(material("cap", **gray))
    return ob


def sleeve(shape):
    """Papier blanc sur le corps et le col : l'éclairage que recevra l'étiquette."""
    s = SHAPES[shape]; prof = profile(s["pts"])
    paper = material("paper", **{"Base Color": (.7, .7, .7, 1), "Roughness": .42})
    for name, (z0, z1) in (("body", s["body"]), ("neck", s["neck"])):
        p = [(z, r + .0006) for z, r in prof if z0 <= z <= z1]
        ob = lathe(name, p, close_bottom=False); ob.data.materials.append(paper)


def px(z):  # hauteur (m) → ligne de pixel
    cam_z = SCALE / 2 - .012
    return round(H / 2 - (z - cam_z) * PPM)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--samples", type=int, default=96); ap.add_argument("--only"); ap.add_argument("--pct", type=int, default=100); ap.add_argument("--variant"); ap.add_argument("--bottles-only", action="store_true"); ap.add_argument("--meta-only", action="store_true")
    a = ap.parse_args([x for x in os.sys.argv[1:]])
    global PCT; PCT = a.pct
    os.makedirs(OUT, exist_ok=True)
    meta = {"size": [W, H], "camera": camera_meta(), "shapes": {}}
    for shape, s in SHAPES.items():
        if a.only and shape != a.only: continue
        prof = profile(s["pts"]); r_at = lambda z: min(prof, key=lambda p: abs(p[0] - z))[1]
        bz, nz = s["body"], s["neck"]
        # Zones d'étiquette : cylindres (rayon et hauteurs en mètres) sur lesquels le navigateur projette l'étiquette.
        meta["shapes"][shape] = {
            "variants": [f"{g}-{l}" for g, l in VARIANTS[shape]], "caps": CAPS[shape],
            "body": {"r": round(r_at((bz[0] + bz[1]) / 2) + .0006, 5), "z0": bz[0], "z1": bz[1]},
            "neck": {"r": round(r_at((nz[0] + nz[1]) / 2) + .0006, 5), "z0": nz[0], "z1": nz[1]},
            "h": s["h"],
        }
        if a.meta_only: continue
        for g, l in VARIANTS[shape]:
            if a.variant and f"{g}-{l}" != a.variant: continue
            sc = reset(); sc.cycles.samples = a.samples; floor(); bottle(shape, g, l); render(sc, os.path.join(OUT, f"{shape}-{g}-{l}"))
        if a.bottles_only: continue
        for k in CAPS[shape]:
            sc = reset(); sc.cycles.samples = 24; cap(shape, k); render(sc, os.path.join(OUT, f"{shape}-cap-{k}"))
        sc = reset(); sc.cycles.samples = 24; sleeve(shape); render(sc, os.path.join(OUT, f"{shape}-sleeve"))
    path = os.path.join(OUT, "bottles.json")
    if a.only and os.path.exists(path):
        old = json.load(open(path)); old["shapes"].update(meta["shapes"]); meta = old
    json.dump(meta, open(path, "w"), indent=1)


if __name__ == "__main__":
    main()
