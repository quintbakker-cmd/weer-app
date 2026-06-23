"""
api.py
------
Flask API die als tussenschakel werkt tussen de webapp en de KNMI Open Data API.
Haalt het meest recente radarvoorspellingsbestand op, verwerkt het naar
transparante PNG-frames en stuurt die terug als JSON.

Endpoints:
    GET /radar   → JSON met 25 base64-gecodeerde PNG-frames + tijdstempels
    GET /ping    → {"status": "ok"} voor keep-alive pings
"""

import io
import re
import os
import json
import base64
import requests
import h5py
import numpy as np
from datetime import datetime, timezone, timedelta
from flask import Flask, jsonify
from flask_cors import CORS
from pyproj import Proj
from PIL import Image

app = Flask(__name__)
CORS(app)  # Staat verzoeken toe van GitHub Pages

API_KEY  = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6ImVlNDFjMWI0MjlkODQ2MThiNWI4ZDViZDAyMTM2YTM3IiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1"
DATASET  = "radar_forecast"
VERSION  = "2.0"
HEADERS  = {"Authorization": API_KEY}

RASTER_RIJEN    = 765
RASTER_KOLOMMEN = 700

PROJ_KNMI = Proj(
    proj="stere", lat_0=90, lon_0=0, lat_ts=60,
    a=6378140, b=6356750, x_0=0, y_0=0,
)

# Kleurentabel: pixelwaarde (mm/5min) → RGBA
# Drempel 0.01 = droog, daarboven neerslag
KLEUR_STAPPEN = [
    (0.00, (0,   0,   0,   0  )),
    (0.01, (150, 220, 255, 180)),
    (0.10, (50,  150, 255, 200)),
    (0.50, (0,   230, 100, 210)),
    (1.00, (255, 255,   0, 220)),
    (2.00, (255, 128,   0, 230)),
    (5.00, (255,   0,   0, 255)),
]


def _interpoleer_kleur(waarde):
    """Interpoleert een RGBA-kleur op basis van de neerslagwaarde."""
    if waarde <= KLEUR_STAPPEN[0][0]:
        return KLEUR_STAPPEN[0][1]
    for i in range(1, len(KLEUR_STAPPEN)):
        v0, k0 = KLEUR_STAPPEN[i - 1]
        v1, k1 = KLEUR_STAPPEN[i]
        if waarde <= v1:
            t = (waarde - v0) / (v1 - v0)
            return tuple(int(k0[j] + t * (k1[j] - k0[j])) for j in range(4))
    return KLEUR_STAPPEN[-1][1]


def _data_naar_png_bytes(data):
    """Zet een 2D numpy-array (mm/5min) om naar een transparante PNG als bytes."""
    hoogte, breedte = data.shape
    rgba = np.zeros((hoogte, breedte, 4), dtype=np.uint8)

    # Vectoriseer de kleurberekening per drempellaag
    for i in range(1, len(KLEUR_STAPPEN)):
        v0, k0 = KLEUR_STAPPEN[i - 1]
        v1, k1 = KLEUR_STAPPEN[i]
        masker = (data > v0) & (data <= v1)
        if not masker.any():
            continue
        t = np.where(masker, (data - v0) / (v1 - v0), 0.0)
        for kanaal in range(4):
            rgba[:, :, kanaal] = np.where(
                masker,
                np.clip(k0[kanaal] + t * (k1[kanaal] - k0[kanaal]), 0, 255).astype(np.uint8),
                rgba[:, :, kanaal],
            )
    # Alles boven de hoogste drempel
    masker = data > KLEUR_STAPPEN[-1][0]
    if masker.any():
        for kanaal, waarde in enumerate(KLEUR_STAPPEN[-1][1]):
            rgba[:, :, kanaal] = np.where(masker, waarde, rgba[:, :, kanaal])

    img = Image.fromarray(rgba, "RGBA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _bereken_marker(lat, lon):
    """Geeft (x_fractie, y_fractie) terug voor een lat/lon op het KNMI-raster,
    als getal tussen 0 en 1 zodat de webapp het op elke kaartgrootte kan plaatsen."""
    x_ll, y_ll = PROJ_KNMI(0.0,    49.362)
    x_ur, y_ur = PROJ_KNMI(10.856, 55.389)
    x_p, y_p   = PROJ_KNMI(lon, lat)
    x_frac = (x_p - x_ll) / (x_ur - x_ll)
    y_frac = (y_ur - y_p) / (y_ur - y_ll)
    return round(float(x_frac), 4), round(float(y_frac), 4)


def _haal_frames_op():
    """Haalt het meest recente KNMI-radarbestand op en geeft een lijst van
    frames terug, elk als dict met 'tijd' en 'png_b64'."""
    # Bestandsnaam ophalen
    r = requests.get(
        f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files",
        headers=HEADERS,
        params={"maxKeys": 1, "orderBy": "lastModified", "sorting": "desc"},
        timeout=15,
    )
    r.raise_for_status()
    bestandsnaam = r.json()["files"][0]["filename"]

    # Download-URL ophalen
    r2 = requests.get(
        f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files/{bestandsnaam}/url",
        headers=HEADERS, timeout=15,
    )
    r2.raise_for_status()

    # Bestand downloaden
    r3 = requests.get(r2.json()["temporaryDownloadUrl"], timeout=30)
    r3.raise_for_status()
    bestand_bytes = io.BytesIO(r3.content)

    # HDF5 inlezen
    frames = []
    with h5py.File(bestand_bytes, "r") as f:
        groepen = sorted(
            [k for k in f.keys() if re.match(r"^image\d+$", k)],
            key=lambda n: int(n[5:]),
        )
        for naam in groepen:
            grp = f[naam]
            tijdstip_raw = grp.attrs.get("image_datetime_valid", b"")
            if isinstance(tijdstip_raw, (bytes, np.bytes_)):
                tijdstip_raw = tijdstip_raw.decode()
            try:
                tijdstip = datetime.strptime(tijdstip_raw, "%d-%b-%Y;%H:%M:%S.%f")
                tijdstip = tijdstip.replace(tzinfo=timezone.utc)
                tijdstip_str = tijdstip.astimezone(timezone(timedelta(hours=2))).strftime("%H:%M")
            except ValueError:
                tijdstip_str = "?"

            ruwe_data = grp["image_data"][:]
            neerslag = ruwe_data.astype(np.float32) * 0.01
            neerslag[ruwe_data >= 65534] = 0.0

            png_bytes = _data_naar_png_bytes(neerslag)
            frames.append({
                "tijd": tijdstip_str,
                "png_b64": base64.b64encode(png_bytes).decode("ascii"),
            })

    return frames


@app.route("/ping")
def ping():
    return jsonify({"status": "ok"})


@app.route("/radar")
def radar():
    try:
        frames = _haal_frames_op()
        x_frac, y_frac = _bereken_marker(52.155, 5.388)
        return jsonify({
            "frames": frames,
            "marker": {"x": x_frac, "y": y_frac},
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
