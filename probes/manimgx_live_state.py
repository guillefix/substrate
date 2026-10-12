"""Capability probe, not a real-time application or VR benchmark.
Uses public Film.picture on a persistent scene. No construct/play/video pipeline.
Run: .venv/bin/python probes/manimgx_live_state.py
"""
import hashlib
import json
import statistics
import time
from pathlib import Path
import manimgx as m
from manimgx import _engine
from PIL import Image

out = Path(__file__).parent / 'results'
out.mkdir(exist_ok=True)
m.config.pixel_width, m.config.pixel_height = 640, 360
scene = m.Scene()
membrane = m.Rectangle(width=10, height=0.65, color='#63788a', fill_opacity=0.5)
channels = [m.Circle(radius=.13, color='#57deb1', fill_opacity=1).move_to([-4.5+i*.3,0,0]) for i in range(31)]
scene.add(membrane, *channels)
film = m.Film()
latencies, hashes = [], []
for frame in range(100):
    # External parameter changes after initial rendering; same objects, no scene rebuild.
    stimulus = 0.0 if frame < 50 else 1.0
    start = time.perf_counter()
    for i, dot in enumerate(channels):
        dot.move_to([-4.5+i*.3, stimulus*(.3+(i%5)*.18),0])
        dot.set_color('#ffab6e' if stimulus else '#57deb1')
    pixels = film.picture(scene.camera, scene.display_list())
    latencies.append((time.perf_counter()-start)*1000)
    if frame in (49, 99):
        hashes.append(hashlib.sha256(pixels).hexdigest())
        Image.frombytes('RGBA',(640,360),pixels).save(out/f'state-{frame}.png')
assert hashes[0] != hashes[1], 'External state did not change pixels'
result = {'engine':_engine.adapter_info(),'objects':32,'resolution':[640,360],
          'frames':100,'first_frame_ms':latencies[0],
          'warm_median_ms':statistics.median(latencies[10:]),
          'warm_p95_ms':sorted(latencies[10:])[int(len(latencies[10:])*.95)],
          'external_state_changes_pixels':True,
          'limitations':'Offscreen native GPU drawing plus CPU pixel readback; no live UI, browser, large scene, or VR tested.'}
(out/'native-probe.json').write_text(json.dumps(result,indent=2)+'\n')
film.close()
print(json.dumps(result,indent=2))
