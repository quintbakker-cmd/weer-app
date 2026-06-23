"""
knmi_radar.py
-------------
Haalt de meest recente neerslag-radarvoorspelling op via de KNMI Open Data API
en toont die als een animatie (25 tijdstappen van 5 minuten = 2 uur vooruit).

Benodigde packages:
    pip install requests h5py matplotlib pyproj

Gebruik:
    python knmi_radar.py
"""

import io
import re
import requests
import h5py
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.animation as animation
import matplotlib.colors as mcolors
from datetime import datetime, timezone, timedelta
from pyproj import Proj

# ─── Instellingen ──────────────────────────────────────────────────────────

API_KEY  = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6ImVlNDFjMWI0MjlkODQ2MThiNWI4ZDViZDAyMTM2YTM3IiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1"
DATASET  = "radar_forecast"
VERSION  = "2.0"
HEADERS  = {"Authorization": API_KEY}

LAT_AMERSFOORT = 52.155
LON_AMERSFOORT = 5.388

# Stereografische projectie zoals opgegeven in geographic/map_projection
PROJ_KNMI = Proj(
    proj="stere",
    lat_0=90, lon_0=0, lat_ts=60,
    a=6378140, b=6356750,  # meters (zelfde als KNMI maar in meters i.p.v. km)
    x_0=0, y_0=0,
)

# Rastergrootte
RASTER_RIJEN    = 765
RASTER_KOLOMMEN = 700
PIXEL_GROOTTE_KM = 1.0          # ~1 km per pixel
GEO_ROW_OFFSET   = 3649.982     # uit geographic groep (in km)
GEO_COL_OFFSET   = 0.0


# ─── Kleurenpalet (vergelijkbaar met buienradar) ───────────────────────────

def maak_kleurenpalet():
    kleuren = [
        (0.000, (0.00, 0.00, 0.00, 0.00)),
        (0.005, (0.60, 0.85, 1.00, 0.80)),
        (0.050, (0.20, 0.60, 1.00, 0.85)),
        (0.200, (0.00, 0.90, 0.40, 0.90)),
        (0.400, (1.00, 1.00, 0.00, 0.90)),
        (0.700, (1.00, 0.50, 0.00, 0.95)),
        (1.000, (1.00, 0.00, 0.00, 1.00)),
    ]
    return mcolors.LinearSegmentedColormap.from_list(
        "buienradar", [(pos, kleur) for pos, kleur in kleuren]
    )


# ─── API-aanroepen ─────────────────────────────────────────────────────────

def haal_laatste_bestandsnaam():
    r = requests.get(
        f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files",
        headers=HEADERS,
        params={"maxKeys": 1, "orderBy": "lastModified", "sorting": "desc"},
        timeout=15,
    )
    r.raise_for_status()
    bestanden = r.json().get("files", [])
    if not bestanden:
        raise RuntimeError("Geen bestanden gevonden.")
    return bestanden[0]["filename"]


def haal_download_url(bestandsnaam):
    r = requests.get(
        f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files/{bestandsnaam}/url",
        headers=HEADERS,
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["temporaryDownloadUrl"]


def download_hdf5(download_url):
    r = requests.get(download_url, timeout=30)
    r.raise_for_status()
    return io.BytesIO(r.content)


# ─── HDF5 inlezen ─────────────────────────────────────────────────────────

def _parse_tijdstip(attrib_waarde):
    """Zet '23-JUN-2026;18:00:00.000' om naar een timezone-aware datetime (UTC)."""
    if isinstance(attrib_waarde, (bytes, np.bytes_)):
        attrib_waarde = attrib_waarde.decode()
    try:
        return datetime.strptime(attrib_waarde, "%d-%b-%Y;%H:%M:%S.%f").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def lees_hdf5(bestand_bytes):
    """Leest image1..image25 uit het KNMI HDF5-bestand en geeft een
    gesorteerde lijst van tijdstappen terug."""
    tijdstappen = []

    with h5py.File(bestand_bytes, "r") as f:
        # Vind alle imageN-groepen en sorteer op getal
        groep_namen = sorted(
            [k for k in f.keys() if re.match(r"^image\d+$", k)],
            key=lambda n: int(n[5:]),
        )

        for naam in groep_namen:
            grp = f[naam]

            # Tijdstempel
            tijdstip = _parse_tijdstip(grp.attrs.get("image_datetime_valid", b""))

            # Ruwe pixelwaarden (uint16)
            ruwe_data = grp["image_data"][:]

            # Kalibratie: GEO = 0.01 × PV  (gain uit calibration_formulas)
            neerslag = ruwe_data.astype(np.float32) * 0.01

            # Masker: 65534 = missing data, 65535 = buiten beeld → zet op 0
            neerslag[ruwe_data >= 65534] = 0.0

            tijdstappen.append({"data": neerslag, "tijd": tijdstip})

    if not tijdstappen:
        raise RuntimeError("Geen tijdstappen gevonden in het HDF5-bestand.")
    return tijdstappen


# ─── Coördinaten → rasterpositie (stereografische projectie) ──────────────

def bereken_rasterpositie():
    """Berekent de (rij, kolom) van Amersfoort op het KNMI-raster via de
    stereografische projectie die KNMI gebruikt."""
    # Projecteer lat/lon naar x,y in meters
    x_m, y_m = PROJ_KNMI(LON_AMERSFOORT, LAT_AMERSFOORT)

    # Zet om naar km
    x_km = x_m / 1000.0
    y_km = y_m / 1000.0

    # KNMI-raster: oorsprong linksboven, y loopt omhoog in projectieruimte
    # geo_row_offset geeft aan hoeveel km de bovenste rij van de pool afzit
    # kolom = x_km / pixel_grootte + col_offset
    # rij   = (geo_row_offset - y_km) / pixel_grootte
    kolom = int(round(x_km / PIXEL_GROOTTE_KM + GEO_COL_OFFSET))
    rij   = int(round((GEO_ROW_OFFSET - y_km) / PIXEL_GROOTTE_KM))

    # Klamp binnen het raster voor het geval de berekening net buiten valt
    rij   = max(0, min(rij,   RASTER_RIJEN    - 1))
    kolom = max(0, min(kolom, RASTER_KOLOMMEN - 1))
    return rij, kolom


# ─── Animatie tonen ────────────────────────────────────────────────────────

def toon_animatie(tijdstappen):
    cmap = maak_kleurenpalet()
    rij, kolom = bereken_rasterpositie()

    fig, ax = plt.subplots(figsize=(7, 8))
    fig.patch.set_facecolor("#1a1a2e")
    ax.set_facecolor("#1a1a2e")
    ax.set_title("KNMI Neerslag Radar Voorspelling", color="white", fontsize=13, pad=10)
    ax.axis("off")

    img = ax.imshow(
        tijdstappen[0]["data"],
        cmap=cmap, vmin=0, vmax=5,
        origin="upper", interpolation="bilinear", aspect="auto",
    )

    ax.plot(kolom, rij, marker="o", color="white", markersize=8,
            markeredgecolor="black", markeredgewidth=1.5, zorder=5)
    ax.text(kolom + 7, rij - 7, "Amersfoort", color="white", fontsize=8,
            fontweight="bold",
            bbox=dict(boxstyle="round,pad=0.2", fc="#00000088", ec="none"))

    cbar = plt.colorbar(img, ax=ax, fraction=0.03, pad=0.02)
    cbar.set_label("mm/5min", color="white", fontsize=10)
    cbar.ax.yaxis.set_tick_params(color="white")
    plt.setp(cbar.ax.yaxis.get_ticklabels(), color="white")

    tijdlabel = ax.text(
        0.01, 0.01, "", transform=ax.transAxes, color="white", fontsize=9,
        bbox=dict(boxstyle="round,pad=0.3", fc="#00000099", ec="none"),
    )

    def update(i):
        stap = tijdstappen[i]
        img.set_data(stap["data"])
        if stap["tijd"]:
            nl = stap["tijd"].astimezone(timezone(timedelta(hours=2)))
            tijdlabel.set_text(f"+{i * 5} min  |  {nl.strftime('%H:%M')} (NL)")
        return img, tijdlabel

    ani = animation.FuncAnimation(
        fig, update, frames=len(tijdstappen),
        interval=400, repeat=True, blit=False,
    )
    plt.tight_layout()
    plt.show()


# ─── Hoofdprogramma ────────────────────────────────────────────────────────

def main():
    print("Stap 1/3: Meest recente bestandsnaam ophalen...")
    bestandsnaam = haal_laatste_bestandsnaam()
    print(f"  → {bestandsnaam}")

    print("Stap 2/3: Download-URL ophalen en bestand downloaden...")
    download_url = haal_download_url(bestandsnaam)
    bestand_bytes = download_hdf5(download_url)
    print(f"  → {len(bestand_bytes.getbuffer()) / 1024:.0f} KB gedownload")

    print("Stap 3/3: HDF5 inlezen en animatie starten...")
    tijdstappen = lees_hdf5(bestand_bytes)
    print(f"  → {len(tijdstappen)} tijdstappen ({len(tijdstappen) * 5} minuten vooruit)")

    # Diagnostiek: wat zijn de maximale neerslagwaarden per tijdstap?
    maxima = [stap["data"].max() for stap in tijdstappen]
    print(f"  → Max neerslag per tijdstap: {[round(m, 3) for m in maxima]}")
    print(f"  → Globaal maximum: {max(maxima):.3f} mm/5min")
    rij, kolom = bereken_rasterpositie()
    print(f"  → Amersfoort op raster: rij={rij}, kolom={kolom}")

    toon_animatie(tijdstappen)


if __name__ == "__main__":
    main()