# Renders the AIGROW specimen: the wordmark as the summit of a laser-cut stack of card sheets,
# photographed on a grey board. Geometry comes from scripts/out/layers.json (npm run specimen).
#
#   blender -b --factory-startup --python render_specimen.py -- <out.png> <width> <height> <samples> [key=value ...]
#
# key=value overrides any entry of CFG (numbers only), e.g. az=30 sun_el=38 for look-dev.
import json
import math
import os
import sys
import time
import warnings

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector, geometry

CFG = dict(
    # camera: three-quarter view from the front-left
    az=22.0,  # degrees from south toward west
    pitch=38.0,  # degrees down from horizontal
    focal=55.0,  # mm on a 36 mm sensor
    margin=0.06,  # empty border around the model, as a fraction of the image height (same px on all sides)
    fit_stakes=0,  # 1: keep the dashed proposed line inside the margins too (shrinks the word ~12%); 0: it may run off the frame
    # sun from the north-west (shadows fall to the lower right of the plan)
    sun_az=298.0,  # compass bearing of the sun (0 = north, 270 = west)
    sun_el=33.0,
    sun_angle=3.0,  # degrees: soft contact shadows
    sun=3.3,  # W/m2; sun * sin(el) / pi + fill = 1 makes lit horizontal faces read their own albedo
    fill=0.42,  # uniform world light
    exposure=0.0,
    edge_glow=0.25,  # emission strength of the laser-edge material only (see below)
    gpu=1,  # 0: CPU only
    dry=0,  # 1: only report the framing, do not render
)
HEX = dict(ground='#B5B1A8', sheet='#EDECE7', summit='#1D1D1B', edge='#4A3628', proposed='#1F2BC0')
SHEET, SUMMIT = 0.085, 0.145  # layer thickness; the letters are a thicker card


# ----------------------------------------------------------------------------- args
argv = sys.argv[sys.argv.index('--') + 1 :] if '--' in sys.argv else []
OUT, RES_X, RES_Y, SAMPLES = argv[0], int(argv[1]), int(argv[2]), int(argv[3])
for kv in argv[4:]:
    k, v = kv.split('=')
    CFG[k] = float(v)
t0 = time.time()
warnings.simplefilter('ignore', DeprecationWarning)  # use_nodes is deprecated for 6.0 but still needed on 5.x


def srgb_to_linear(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c) + (1.0,)


def setp(obj, **props):  # tolerate property renames between Blender versions
    for k, v in props.items():
        try:
            setattr(obj, k, v)
        except (AttributeError, TypeError) as e:
            print(f'WARN cannot set {obj}.{k}: {e}')


# ----------------------------------------------------------------------------- scene reset
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'

here = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(here, '..', 'out', 'layers.json'), encoding='utf8'))


# ----------------------------------------------------------------------------- materials
def enable_nodes(idblock):
    try:
        idblock.use_nodes = True
    except AttributeError:  # Blender 6: node trees are always on
        pass


def material(name, hex_, rough, spec=0.3):
    m = bpy.data.materials.new(name)
    enable_nodes(m)
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb_to_linear(hex_)
    b.inputs['Roughness'].default_value = rough
    for k in ('Specular IOR Level', 'Specular'):
        if k in b.inputs:
            b.inputs[k].default_value = spec
            break
    return m


M = dict(
    ground=material('board', HEX['ground'], 0.95, 0.2),
    sheet=material('museum-board', HEX['sheet'], 0.9),
    summit=material('graphite-card', HEX['summit'], 0.9, 0.06),
    edge=material('laser-edge', HEX['edge'], 0.9, 0.25),
    proposed=material('proposed', HEX['proposed'], 0.7, 0.0),  # no specular: it lifted the dash core to #2F37C0
)
# The camera-facing walls sit in shade and render near-black (R~54 vs R=74 for the palette); a faint emission lifts
# them onto the palette without touching board, sheets, letters or cast shadows. Keep <= 0.3: the sun-lit walls overshoot.
eb = M['edge'].node_tree.nodes['Principled BSDF']
eb.inputs['Emission Color'].default_value = srgb_to_linear(HEX['edge'])
eb.inputs['Emission Strength'].default_value = CFG['edge_glow']


# ----------------------------------------------------------------------------- geometry
def signed_area(pts):
    return 0.5 * sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))


def loops(ring, ccw):
    """Plate (x, z) -> Blender (x, -z), wound CCW (outer) or CW (hole), split into simple loops.

    The contour data holds repeated points and zero-area spurs (P -> Q -> P) that break the cap
    triangulation; a loop that returns to a vertex already on the stack is cut off and kept (or dropped
    when it has fewer than 3 points).
    """
    pts = [(x, -z) for x, z in ring]
    if (signed_area(pts) > 0) != ccw:
        pts.reverse()
    out, stack, at = [], [], {}
    for p in pts:
        k = (round(p[0], 4), round(p[1], 4))
        if k in at:
            i = at[k]
            loop = stack[i:]
            for q in stack[i + 1 :]:
                del at[(round(q[0], 4), round(q[1], 4))]
            del stack[i + 1 :]
            if len(loop) >= 3:
                out.append(loop)
        else:
            at[k] = len(stack)
            stack.append(p)
    if len(stack) >= 3:
        out.append(stack)
    return [(r, signed_area(r)) for r in out]


def build_layer(index, polygons):
    z0 = index * SHEET
    t = SUMMIT if index == 12 else SHEET
    bm = bmesh.new()
    net_area = 0.0
    for polygon in polygons:
        rings = []
        for k, ring in enumerate(polygon):
            for pts, area in loops(ring, ccw=(k == 0)):
                rings.append(pts)
                net_area += area
        flat = [(x, y) for r in rings for x, y in r]
        top = [bm.verts.new((x, y, z0 + t)) for x, y in flat]
        bot = [bm.verts.new((x, y, z0)) for x, y in flat]
        for a, b, c in geometry.tessellate_polygon([[Vector((x, y, 0.0)) for x, y in r] for r in rings]):
            if (flat[b][0] - flat[a][0]) * (flat[c][1] - flat[a][1]) - (flat[b][1] - flat[a][1]) * (flat[c][0] - flat[a][0]) < 0:
                b, c = c, b  # make the cap triangle face up
            bm.faces.new((top[a], top[b], top[c]))
            bm.faces.new((bot[a], bot[c], bot[b]))
        off = 0
        for r in rings:  # walls: right of travel is out of the material for CCW outers and CW holes
            for j in range(len(r)):
                a, b = off + j, off + (j + 1) % len(r)
                bm.faces.new((bot[a], bot[b], top[b], top[a]))
            off += len(r)
    bm.normal_update()
    vol = bm.calc_volume(signed=True)
    assert abs(vol - net_area * t) < 0.02 * net_area * t, f'layer {index}: volume {vol:.4f} vs {net_area * t:.4f} (inverted normals or filled holes)'
    for f in bm.faces:
        f.smooth = True
        f.material_index = 0 if abs(f.normal.z) > 0.5 else 1
    for e in bm.edges:  # keep real corners crisp, round off contour facets
        if e.calc_face_angle(0.0) > math.radians(35):
            e.smooth = False
    me = bpy.data.meshes.new(f'layer{index:02d}')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['summit'] if index == 12 else M['sheet'])  # slot 0: top/bottom faces
    me.materials.append(M['edge'])  # slot 1: laser-burned side walls
    obj = bpy.data.objects.new(f'layer{index:02d}', me)
    scene.collection.objects.link(obj)
    return obj


layers = [build_layer(l['index'], l['polygons']) for l in data['layers']]
print(f'layers built: {sum(len(o.data.polygons) for o in layers)} faces, t={time.time() - t0:.1f}s')


def build_stakes(polygons, dash=0.17, gap=0.13, width=0.034, height=0.004):
    """The planned-but-unbuilt layer: a dashed line of flat ultramarine strips on the ground."""
    bm = bmesh.new()
    for polygon in polygons:
        pts = max(loops(polygon[0], ccw=True), key=lambda l: len(l[0]))[0]
        pts = pts + [pts[0]]
        seg = [math.dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
        total = sum(seg)

        def at(s):
            for i, d in enumerate(seg):
                if s <= d or i == len(seg) - 1:
                    u = min(s / d, 1.0) if d else 0.0
                    return (pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u)
                s -= d

        s = 0.0
        while s + dash < total:
            a, b = at(s), at(s + dash)
            d = math.dist(a, b) or 1.0
            nx, ny = -(b[1] - a[1]) / d * width / 2, (b[0] - a[0]) / d * width / 2
            v = [bm.verts.new((x + sx * nx, y + sx * ny, z)) for z in (0.0, height) for (x, y) in (a, b) for sx in (-1, 1)]
            # v index: z*4 + end*2 + (0 left / 1 right)
            for q in ((4, 5, 7, 6), (0, 2, 3, 1), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)):
                bm.faces.new([v[i] for i in q])
            s += dash + gap
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new('proposed-stakes')
    bm.to_mesh(me)
    bm.free()
    me.materials.append(M['proposed'])
    obj = bpy.data.objects.new('proposed-stakes', me)
    scene.collection.objects.link(obj)
    return obj


stakes = build_stakes(data['staked']['polygons'])

ground = bpy.data.objects.new('ground', bpy.data.meshes.new('ground'))
bmg = bmesh.new()
bmesh.ops.create_grid(bmg, x_segments=1, y_segments=1, size=150.0)
bmg.to_mesh(ground.data)
bmg.free()
ground.data.materials.append(M['ground'])
scene.collection.objects.link(ground)

# ----------------------------------------------------------------------------- light
az, el = math.radians(CFG['sun_az']), math.radians(CFG['sun_el'])
to_sun = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), math.sin(el)))
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = CFG['sun']
sun.data.angle = math.radians(CFG['sun_angle'])
sun.rotation_euler = (-to_sun).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(sun)

world = bpy.data.worlds.new('studio')
scene.world = world
enable_nodes(world)
bg = world.node_tree.nodes['Background']
bg.inputs['Color'].default_value = (1.0, 1.0, 1.0, 1.0)
bg.inputs['Strength'].default_value = CFG['fill']

# ----------------------------------------------------------------------------- camera
setp(scene.render, resolution_x=RES_X, resolution_y=RES_Y, resolution_percentage=100)
cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
setp(cam.data, lens=CFG['focal'], sensor_width=36.0, sensor_fit='HORIZONTAL', clip_start=0.1, clip_end=500.0)
scene.collection.objects.link(cam)
scene.camera = cam


def fit_camera(points, target):
    """Frame `points` with the same pixel margin on every side by moving back and sliding the lens (no re-aim)."""
    p, a = math.radians(CFG['pitch']), math.radians(CFG['az'])
    back = Vector((-math.sin(a) * math.cos(p), -math.cos(a) * math.cos(p), math.sin(p)))
    cam.rotation_euler = (-back).to_track_quat('-Z', 'Y').to_euler()
    mx, my = CFG['margin'] * RES_Y / RES_X, CFG['margin']
    dist = 30.0
    for _ in range(14):
        cam.location = target + back * dist
        bpy.context.view_layer.update()
        ndc = [world_to_camera_view(scene, cam, q) for q in points]
        x0, x1 = min(n.x for n in ndc), max(n.x for n in ndc)
        y0, y1 = min(n.y for n in ndc), max(n.y for n in ndc)
        cam.data.shift_x += (x0 + x1) / 2 - 0.5
        cam.data.shift_y += ((y0 + y1) / 2 - 0.5) * RES_Y / RES_X
        dist *= max((x1 - x0) / (1 - 2 * mx), (y1 - y0) / (1 - 2 * my))
    return dist


base = layers[0].data
frame_pts = [layers[0].matrix_world @ v.co for v in base.vertices]
frame_pts += [Vector((v.co.x, v.co.y, 12 * SHEET + SUMMIT)) for v in layers[12].data.vertices]
frame_pts += [v.co for v in stakes.data.vertices] if CFG['fit_stakes'] else []
box = [max(p[i] for p in frame_pts) / 2 + min(p[i] for p in frame_pts) / 2 for i in range(3)]
distance = fit_camera(frame_pts, Vector((box[0], box[1], 0.55)))

# ----------------------------------------------------------------------------- render settings
prefs = bpy.context.preferences.addons['cycles'].preferences
scene.cycles.device, device = 'CPU', 'CPU'
if CFG['gpu']:
    try:
        prefs.compute_device_type = 'CUDA'
        prefs.refresh_devices()
        gpus = [d for d in prefs.devices if d.type in ('CUDA', 'OPTIX')]
        if gpus:
            # OptiX only pays off with RT cores (RTX); a GTX 16xx is faster on CUDA. The CPU joins in.
            kind = 'OPTIX' if any('RTX' in d.name for d in gpus) else 'CUDA'
            prefs.compute_device_type = kind
            for d in prefs.devices:
                d.use = d.type in (kind, 'CPU')
            scene.cycles.device, device = 'GPU', kind + '+CPU'
    except Exception as e:  # noqa: BLE001
        print(f'WARN GPU setup failed, rendering on the CPU: {e}')

setp(
    scene.cycles,
    samples=SAMPLES,
    use_adaptive_sampling=True,
    adaptive_threshold=0.01,
    adaptive_min_samples=24,
    use_denoising=True,
    denoiser='OPENIMAGEDENOISE',
    denoising_input_passes='RGB_ALBEDO_NORMAL',
    denoising_prefilter='ACCURATE',
    max_bounces=6,
    diffuse_bounces=4,
    glossy_bounces=2,
    transmission_bounces=0,
    volume_bounces=0,
    transparent_max_bounces=0,
    sample_clamp_indirect=5.0,
    pixel_filter_type='BLACKMAN_HARRIS',
    filter_width=1.3,
)
setp(scene.view_settings, view_transform='Standard', look='None', exposure=CFG['exposure'], gamma=1.0)
setp(scene.display_settings, display_device='sRGB')
setp(scene.render, film_transparent=False, filepath=OUT, use_file_extension=True)
setp(scene.render.image_settings, file_format='PNG', color_mode='RGB', color_depth='16', compression=15)

word = [world_to_camera_view(scene, cam, v.co) for v in layers[12].data.vertices]
word_w = (max(n.x for n in word) - min(n.x for n in word)) * RES_X
print(f'word spans {word_w:.0f}px of {RES_X} ({word_w / RES_X:.0%}); {(max(n.y for n in word) - min(n.y for n in word)) * RES_Y:.0f}px tall')
if CFG['dry']:
    sys.exit(0)
bpy.ops.render.render(write_still=True)
print(
    f'DONE {OUT} {RES_X}x{RES_Y} samples={SAMPLES} device={device} distance={distance:.2f} '
    f'cam={tuple(round(c, 3) for c in cam.location)} shift=({cam.data.shift_x:.4f},{cam.data.shift_y:.4f}) '
    f'seconds={time.time() - t0:.1f}'
)
