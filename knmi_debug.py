"""
knmi_debug.py
-------------
Inspecteert de structuur van het gedownloade HDF5-bestand zodat we weten
hoe de data er precies in zit.
"""

import io
import requests
import h5py

API_KEY  = "eyJvcmciOiI1ZTU1NGUxOTI3NGE5NjAwMDEyYTNlYjEiLCJpZCI6ImVlNDFjMWI0MjlkODQ2MThiNWI4ZDViZDAyMTM2YTM3IiwiaCI6Im11cm11cjEyOCJ9"
BASE_URL = "https://api.dataplatform.knmi.nl/open-data/v1"
DATASET  = "radar_forecast"
VERSION  = "2.0"
HEADERS  = {"Authorization": API_KEY}

def haal_bestand():
    # Laatste bestand ophalen
    r = requests.get(f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files",
                     headers=HEADERS, params={"maxKeys": 1, "orderBy": "lastModified", "sorting": "desc"}, timeout=15)
    r.raise_for_status()
    bestandsnaam = r.json()["files"][0]["filename"]
    print(f"Bestand: {bestandsnaam}\n")

    # Download URL
    r2 = requests.get(f"{BASE_URL}/datasets/{DATASET}/versions/{VERSION}/files/{bestandsnaam}/url",
                      headers=HEADERS, timeout=15)
    r2.raise_for_status()
    url = r2.json()["temporaryDownloadUrl"]

    # Download
    r3 = requests.get(url, timeout=30)
    r3.raise_for_status()
    return io.BytesIO(r3.content)

def inspecteer(bestand_bytes):
    def druk_groep_af(naam, obj, diepte=0):
        inspringing = "  " * diepte
        if isinstance(obj, h5py.Group):
            print(f"{inspringing}📁 {naam}/")
            # Attributen van de groep
            for k, v in obj.attrs.items():
                print(f"{inspringing}   attr: {k} = {v!r}")
            for kind_naam, kind in obj.items():
                druk_groep_af(kind_naam, kind, diepte + 1)
        elif isinstance(obj, h5py.Dataset):
            print(f"{inspringing}📄 {naam}  shape={obj.shape}  dtype={obj.dtype}")
            for k, v in obj.attrs.items():
                print(f"{inspringing}   attr: {k} = {v!r}")

    with h5py.File(bestand_bytes, "r") as f:
        print("=== Volledige structuur ===\n")
        for naam, obj in f.items():
            druk_groep_af(naam, obj)

bestand = haal_bestand()
inspecteer(bestand)
