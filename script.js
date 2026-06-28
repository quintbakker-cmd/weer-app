// ─── Instellingen ──────────────────────────────────────────────────────────

const STANDAARD_LOCATIE = {
    naam: "Amersfoort",
    latitude: 52.155,
    longitude: 5.3875,
    timezone: "Europe/Amsterdam",
};

const RADAR_API_URL = "https://weer-app-32ch.onrender.com/radar";

// Probeer een eerder opgeslagen locatie te laden, anders gebruik de standaard
let huidigeLocatie = STANDAARD_LOCATIE;
const opgeslagenLocatie = localStorage.getItem("weerapp-locatie");
if (opgeslagenLocatie) {
    try {
        huidigeLocatie = JSON.parse(opgeslagenLocatie);
    } catch (fout) {
        huidigeLocatie = STANDAARD_LOCATIE;
    }
}

// Bewaart de laatst opgehaalde pollendata zodat de dag-overlay deze ook kan gebruiken
let huidigePollenPerUur = null;

// ─── Weercodes → beschrijving + emoji ─────────────────────────────────────

const WEERCODES = {
    0:  ["Heldere hemel",           "☀️", "🌙"],
    1:  ["Overwegend helder",        "🌤️", "🌙"],
    2:  ["Gedeeltelijk bewolkt",     "⛅",  "☁️"],
    3:  ["Bewolkt",                  "☁️",  "☁️"],
    45: ["Mist",                     "🌫️", "🌫️"],
    48: ["IJsmist",                  "🌫️", "🌫️"],
    51: ["Lichte miezer",            "🌦️", "🌧️"],
    53: ["Matige miezer",            "🌦️", "🌧️"],
    55: ["Zware miezer",             "🌧️", "🌧️"],
    61: ["Lichte regen",             "🌧️", "🌧️"],
    63: ["Matige regen",             "🌧️", "🌧️"],
    65: ["Zware regen",              "🌧️", "🌧️"],
    71: ["Lichte sneeuw",            "🌨️", "🌨️"],
    73: ["Matige sneeuw",            "🌨️", "🌨️"],
    75: ["Zware sneeuw",             "❄️",  "❄️"],
    77: ["Ijskorrels",               "🌨️", "🌨️"],
    80: ["Lichte buien",             "🌦️", "🌧️"],
    81: ["Matige buien",             "🌧️", "🌧️"],
    82: ["Zware buien",              "⛈️",  "⛈️"],
    85: ["Lichte sneeuwbuien",       "🌨️", "🌨️"],
    86: ["Zware sneeuwbuien",        "❄️",  "❄️"],
    95: ["Onweer",                   "⛈️",  "⛈️"],
    96: ["Onweer met hagel",         "⛈️",  "⛈️"],
    99: ["Zwaar onweer met hagel",   "⛈️",  "⛈️"],
};

function weercodeInfo(code, isNacht = false) {
    const weercode = WEERCODES[code] || ["Onbekend", "❓", "🌙"];
    return [weercode[0], isNacht ? weercode[2] : weercode[1]];
}

// ─── Tijd helpers ──────────────────────────────────────────────────────────

function naarUurString(isoString) {
    const dt = new Date(isoString);
    return dt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

function naarDagString(isoString) {
    const dt = new Date(isoString);
    return dt.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

function naarDatumTijdString(isoString) {
    const dt = new Date(isoString);
    const dag = dt.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
    const tijd = dt.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
    return `${dag} ${tijd}`;
}

// ─── Data ophalen ──────────────────────────────────────────────────────────

async function haalWeerOp() {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", huidigeLocatie.latitude);
    url.searchParams.set("longitude", huidigeLocatie.longitude);
    url.searchParams.set("timezone", huidigeLocatie.timezone);
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,rain_sum");
    url.searchParams.set("hourly", "temperature_2m,rain,showers,apparent_temperature,relative_humidity_2m,cloud_cover,weather_code,precipitation_probability");
    url.searchParams.set("current", "temperature_2m,apparent_temperature,rain,showers,weather_code");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`API fout: ${response.status}`);
    return response.json();
}

// ─── Pollen data ophalen ─────────────────────────────────────────────────

async function haalPollenOp() {
    const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
    url.searchParams.set("latitude", huidigeLocatie.latitude);
    url.searchParams.set("longitude", huidigeLocatie.longitude);
    url.searchParams.set("timezone", huidigeLocatie.timezone);
    url.searchParams.set("hourly", "alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen");

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Pollen API fout: ${response.status}`);
    return response.json();
}

function pollenNiveau(totaal) {
    if (totaal === null || totaal === undefined || Number.isNaN(totaal)) return { label: "Onbekend", emoji: "❓" };
    if (totaal < 10)  return { label: "Laag",      emoji: "🟢" };
    if (totaal < 30)  return { label: "Matig",     emoji: "🟡" };
    if (totaal < 70)  return { label: "Hoog",      emoji: "🟠" };
    return                     { label: "Zeer hoog", emoji: "🔴" };
}

function parsePollenPerUur(pollenData) {
    const h = pollenData.hourly;
    const soorten = ["alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"];
    return h.time.map((t, i) => {
        let totaal = 0;
        soorten.forEach(s => { if (h[s]?.[i] != null) totaal += h[s][i]; });
        return { tijdISO: t, totaal: Math.round(totaal * 10) / 10 };
    });
}

function vindPollenVoorTijd(pollenPerUur, isoTijd) {
    const doel = new Date(isoTijd).getTime();
    return pollenPerUur.reduce((best, punt) =>
        Math.abs(new Date(punt.tijdISO).getTime() - doel) <
        Math.abs(new Date(best.tijdISO).getTime() - doel) ? punt : best
    ).totaal;
}

function vindPollenVoorDag(pollenPerUur, datumISO) {
    const dag = datumISO.split("T")[0];
    const punten = pollenPerUur.filter(p => p.tijdISO.startsWith(dag));
    return punten.length ? Math.max(...punten.map(p => p.totaal)) : null;
}

// ─── Locatie zoeken (geocoding) ─────────────────────────────────────────

async function zoekLocaties(zoekterm) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", zoekterm);
    url.searchParams.set("count", 5);
    url.searchParams.set("language", "nl");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Geocoding fout: ${response.status}`);
    const data = await response.json();
    return data.results || [];
}

function veranderLocatie(nieuweLocatie) {
    huidigeLocatie = nieuweLocatie;
    localStorage.setItem("weerapp-locatie", JSON.stringify(nieuweLocatie));
    document.getElementById("locatie-naam").textContent = nieuweLocatie.naam;
    laadWeerData();

    // Marker verplaatsen naar nieuwe locatie (alleen zichtbaar als die in NL ligt)
    if (radarMarker) radarMarker.setLatLng([nieuweLocatie.latitude, nieuweLocatie.longitude]);
    if (radarKaart) haalRadarFramesOp();
}

// ─── Data verwerken naar nette objecten ───────────────────────────────────

function parseHuidig(data) {
    const c = data.current;
    const h = data.hourly;
    const nu = new Date();
    const [beschrijving, emoji] = weercodeInfo(c.weather_code);

    let dichtstbijIndex = 0;
    let kleinsteVerschil = Infinity;
    h.time.forEach((t, i) => {
        const v = Math.abs(new Date(t).getTime() - nu.getTime());
        if (v < kleinsteVerschil) { kleinsteVerschil = v; dichtstbijIndex = i; }
    });

    return {
        tijd: naarDatumTijdString(nu.toISOString()),
        temperatuur: Math.round(c.temperature_2m * 10) / 10,
        gevoelstemperatuur: Math.round(c.apparent_temperature * 10) / 10,
        regen: Math.round(c.rain * 10) / 10,
        buien: Math.round(c.showers * 10) / 10,
        neerslagkans: h.precipitation_probability[dichtstbijIndex],
        beschrijving, emoji,
    };
}

function _bouwZontijden(data) {
    const d = data.daily;
    const zontijden = {};
    for (let i = 0; i < d.time.length; i++) {
        zontijden[d.time[i]] = {
            opgang:    new Date(d.sunrise[i]).getTime(),
            ondergang: new Date(d.sunset[i]).getTime(),
        };
    }
    return zontijden;
}

function _bouwUurItem(h, i, zontijden) {
    const dagDatum = h.time[i].split("T")[0];
    const zon = zontijden[dagDatum];
    const ts = new Date(h.time[i]).getTime();
    const isNacht = zon ? (ts < zon.opgang || ts >= zon.ondergang) : false;
    return {
        tijdISO:            h.time[i],
        tijd:               naarUurString(h.time[i]),
        temperatuur:        Math.round(h.temperature_2m[i] * 10) / 10,
        gevoelstemperatuur: Math.round(h.apparent_temperature[i] * 10) / 10,
        regen:              Math.round(h.rain[i] * 10) / 10,
        buien:              Math.round(h.showers[i] * 10) / 10,
        luchtvochtigheid:   Math.round(h.relative_humidity_2m[i]),
        bewolking:          Math.round(h.cloud_cover[i]),
        weercode:           h.weather_code[i],
        neerslagkans:       h.precipitation_probability[i],
        isNacht,
    };
}

function parseUurlijks(data) {
    const h = data.hourly;
    const nu = new Date();
    const zontijden = _bouwZontijden(data);
    const lijst = [];
    for (let i = 0; i < h.time.length; i++) {
        if (new Date(h.time[i]) < nu) continue;
        lijst.push(_bouwUurItem(h, i, zontijden));
    }
    return lijst;
}

function parseAlleUren(data) {
    const h = data.hourly;
    const zontijden = _bouwZontijden(data);
    return h.time.map((_, i) => _bouwUurItem(h, i, zontijden));
}

function parseDagelijks(data) {
    const d = data.daily;
    return d.time.map((t, i) => {
        const [beschrijving, emoji] = weercodeInfo(d.weather_code[i]);
        return {
            datumISO: t,
            datum: naarDagString(t),
            maxTemp: Math.round(d.temperature_2m_max[i] * 10) / 10,
            minTemp: Math.round(d.temperature_2m_min[i] * 10) / 10,
            regenSom: Math.round(d.rain_sum[i] * 10) / 10,
            zonsopgang: naarUurString(d.sunrise[i]),
            zonsondergang: naarUurString(d.sunset[i]),
            beschrijving, emoji,
        };
    });
}

// ─── Data tonen in de pagina ───────────────────────────────────────────────

function toonHuidig(huidig) {
    document.getElementById("huidig-tijd").textContent = huidig.tijd;
    document.getElementById("huidig-emoji").textContent = huidig.emoji;
    document.getElementById("huidig-temp").textContent = `${huidig.temperatuur}°`;
    document.getElementById("huidig-beschrijving").textContent = huidig.beschrijving;
    document.getElementById("huidig-gevoel").textContent = `${huidig.gevoelstemperatuur}°`;
    document.getElementById("huidig-regen").textContent = `${huidig.regen} mm`;
    document.getElementById("huidig-buien").textContent = `${huidig.buien} mm`;
    document.getElementById("huidig-neerslagkans").textContent = `${huidig.neerslagkans}%`;
}

function toonPollenHuidig(pollenTotaal) {
    const niveau = pollenNiveau(pollenTotaal);
    document.getElementById("huidig-pollen").textContent = `${niveau.emoji} ${niveau.label}`;
}

function toonUurlijks(uurLijst) {
    const container = document.getElementById("uur-rij");
    container.innerHTML = "";
    uurLijst.slice(0, 24).forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode, uur.isNacht);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart" + (uur.isNacht ? " uur-kaart-nacht" : "");
        kaart.innerHTML = `
            <div class="uur-tijd">${uur.tijd}</div>
            <div class="uur-emoji">${emoji}</div>
            <div class="uur-temp">${uur.temperatuur}°</div>
            ${uur.neerslagkans > 0 ? `<div class="uur-neerslagkans">💧 ${uur.neerslagkans}%</div>` : ""}
        `;
        container.appendChild(kaart);
    });
}

function toonDagelijks(dagLijst, alleUren) {
    const container = document.getElementById("dag-lijst");
    container.innerHTML = "";
    dagLijst.forEach(dag => {
        const rij = document.createElement("div");
        rij.className = "dag-rij";
        rij.innerHTML = `
            <div class="dag-datum">${dag.datum}</div>
            <div class="dag-emoji">${dag.emoji}</div>
            <div class="dag-min">${dag.minTemp}°</div>
            <div class="dag-max">${dag.maxTemp}°</div>
        `;
        rij.addEventListener("click", () => toonDagOverlay(dag, alleUren));
        container.appendChild(rij);
    });
}

// ─── Dag detail overlay ─────────────────────────────────────────────────

function toonDagOverlay(dag, alleUren) {
    document.getElementById("overlay-datum").textContent = dag.datum;
    document.getElementById("overlay-emoji").textContent = dag.emoji;
    document.getElementById("overlay-temp").textContent = `${dag.minTemp}° / ${dag.maxTemp}°`;
    document.getElementById("overlay-beschrijving").textContent = dag.beschrijving;
    document.getElementById("overlay-zonsopgang").textContent = dag.zonsopgang;
    document.getElementById("overlay-zonsondergang").textContent = dag.zonsondergang;
    document.getElementById("overlay-regen").textContent = `${dag.regenSom} mm`;

    if (huidigePollenPerUur) {
        const niveau = pollenNiveau(vindPollenVoorDag(huidigePollenPerUur, dag.datumISO));
        document.getElementById("overlay-pollen").textContent = `${niveau.emoji} ${niveau.label}`;
    } else {
        document.getElementById("overlay-pollen").textContent = "Onbekend";
    }

    const urenContainer = document.getElementById("overlay-uren");
    urenContainer.innerHTML = "";
    alleUren.filter(u => u.tijdISO.startsWith(dag.datumISO)).forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode, uur.isNacht);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart" + (uur.isNacht ? " uur-kaart-nacht" : "");
        kaart.innerHTML = `
            <div class="uur-tijd">${uur.tijd}</div>
            <div class="uur-emoji">${emoji}</div>
            <div class="uur-temp">${uur.temperatuur}°</div>
            ${uur.neerslagkans > 0 ? `<div class="uur-neerslagkans">💧 ${uur.neerslagkans}%</div>` : ""}
        `;
        urenContainer.appendChild(kaart);
    });

    document.getElementById("dag-overlay").classList.add("zichtbaar");
}

function verbergDagOverlay() {
    document.getElementById("dag-overlay").classList.remove("zichtbaar");
}

// ─── Golvende achtergrond animatie ─────────────────────────────────────────

function startGolvenAnimatie() {
    const canvas = document.getElementById("golven-achtergrond");
    const ctx = canvas.getContext("2d");

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        tekenGolven();
    }

    function tekenGolven() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const golfBreedte = 120;
        [{ alpha: 0.35, offsetY: 0 }, { alpha: 0.2, offsetY: 40 }].forEach(laag => {
            ctx.strokeStyle = `rgba(255, 255, 255, ${laag.alpha})`;
            ctx.lineWidth = 1.8;
            let y = laag.offsetY;
            while (y < canvas.height + 60) {
                ctx.beginPath();
                for (let x = -golfBreedte; x <= canvas.width + golfBreedte; x += 4) {
                    const gy = y + Math.sin((x / golfBreedte) * Math.PI * 2) * 18;
                    x === -golfBreedte ? ctx.moveTo(x, gy) : ctx.lineTo(x, gy);
                }
                ctx.stroke();
                y += 55;
            }
        });
    }

    window.addEventListener("resize", resize);
    resize();
}

// ─── Weer laden ────────────────────────────────────────────────────────────

async function laadWeerData() {
    try {
        const data = await haalWeerOp();
        toonHuidig(parseHuidig(data));
        toonUurlijks(parseUurlijks(data));
        toonDagelijks(parseDagelijks(data), parseAlleUren(data));

        try {
            const pollenData = await haalPollenOp();
            const pollenPerUur = parsePollenPerUur(pollenData);
            huidigePollenPerUur = pollenPerUur;
            toonPollenHuidig(vindPollenVoorTijd(pollenPerUur, new Date().toISOString()));
        } catch (pollenFout) {
            console.error("Kon pollendata niet ophalen:", pollenFout);
            huidigePollenPerUur = null;
        }
    } catch (fout) {
        console.error("Kon weerdata niet ophalen:", fout);
        document.getElementById("huidig-beschrijving").textContent = "Kon weer niet laden";
    }
}

// ─── Locatie overlay bediening ──────────────────────────────────────────

function toonLocatieOverlay() {
    document.getElementById("locatie-overlay").classList.add("zichtbaar");
    document.getElementById("locatie-input").value = "";
    document.getElementById("locatie-resultaten").innerHTML = "";
    document.getElementById("locatie-input").focus();
}

function verbergLocatieOverlay() {
    document.getElementById("locatie-overlay").classList.remove("zichtbaar");
}

let zoekTimer = null;

function opZoekInput(event) {
    const zoekterm = event.target.value.trim();
    clearTimeout(zoekTimer);
    if (zoekterm.length < 2) {
        document.getElementById("locatie-resultaten").innerHTML = "";
        return;
    }
    zoekTimer = setTimeout(async () => {
        const container = document.getElementById("locatie-resultaten");
        container.innerHTML = `<p class="locatie-melding">Zoeken...</p>`;
        try {
            const resultaten = await zoekLocaties(zoekterm);
            if (resultaten.length === 0) {
                container.innerHTML = `<p class="locatie-melding">Geen plaatsen gevonden</p>`;
                return;
            }
            container.innerHTML = "";
            resultaten.forEach(plaats => {
                const knop = document.createElement("button");
                knop.className = "locatie-resultaat";
                knop.innerHTML = `
                    ${plaats.name}
                    <span class="locatie-resultaat-land">${plaats.admin1 ? plaats.admin1 + ", " : ""}${plaats.country || ""}</span>
                `;
                knop.addEventListener("click", () => {
                    veranderLocatie({
                        naam: plaats.name,
                        latitude: plaats.latitude,
                        longitude: plaats.longitude,
                        timezone: plaats.timezone,
                    });
                    verbergLocatieOverlay();
                });
                container.appendChild(knop);
            });
        } catch (fout) {
            console.error("Kon locaties niet zoeken:", fout);
            container.innerHTML = `<p class="locatie-melding">Zoeken mislukt</p>`;
        }
    }, 400);
}

// ─── KNMI Buienradar ───────────────────────────────────────────────────────

// Geografische grenzen van het KNMI radarraster (benaderd rechthoekig voor Leaflet)
const RADAR_BOUNDS = [[48.895, -0.473], [55.974, 10.856]];

let radarKaart    = null;
let radarMarker   = null;
let radarOverlay  = null;
let radarFrames   = [];
let radarIndex    = 0;
let radarTimer    = null;
let radarSpeelt   = false;

function initRadarKaart() {
    radarKaart = L.map("radar-kaart", {
        zoomControl: false,
        attributionControl: false,
        minZoom: 4,
        maxZoom: 11,
    }).setView([52.3, 5.3], 7); // start op Nederland

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 11,
    }).addTo(radarKaart);

    // Legenda
    const legenda = L.control({ position: "bottomright" });
    legenda.onAdd = function () {
        const div = L.DomUtil.create("div", "radar-legenda");
        div.innerHTML = `
            <button class="radar-legenda-toggle" id="legenda-toggle">▲ Legenda</button>
            <div class="radar-legenda-inhoud" id="legenda-inhoud">
                <div class="radar-legenda-rij"><span style="background:rgba(180,230,255,0.85)"></span> &lt;0.01 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(150,220,255,0.9)"></span> 0.01–0.10 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(50,150,255,0.9)"></span> 0.10–0.50 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(0,230,100,0.9)"></span> 0.50–1.00 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(255,255,0,0.9)"></span> 1.00–2.00 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(255,128,0,0.95)"></span> 2.00–5.00 mm/5min</div>
                <div class="radar-legenda-rij"><span style="background:rgba(255,0,0,1)"></span> &gt;5.00 mm/5min</div>
            </div>
        `;
        L.DomEvent.disableClickPropagation(div);
        div.querySelector("#legenda-toggle").addEventListener("click", () => {
            const inhoud = div.querySelector("#legenda-inhoud");
            const knop = div.querySelector("#legenda-toggle");
            const ingeklapt = inhoud.style.display === "none";
            inhoud.style.display = ingeklapt ? "block" : "none";
            knop.textContent = ingeklapt ? "▲ Legenda" : "▼ Legenda";
        });
        return div;
    };
    legenda.addTo(radarKaart);

    radarMarker = L.circleMarker([huidigeLocatie.latitude, huidigeLocatie.longitude], {
        radius: 6,
        color: "#0d2b40",
        fillColor: "#ffffff",
        fillOpacity: 1,
        weight: 2,
    }).addTo(radarKaart);

    haalRadarFramesOp();
}

async function haalRadarFramesOp() {
    const melding = document.getElementById("radar-melding");
    melding.style.display = "block";
    melding.textContent = "Radardata ophalen...";

    if (radarTimer) clearInterval(radarTimer);
    radarSpeelt = false;
    document.getElementById("radar-afspelen").textContent = "▶";

    try {
        const r = await fetch(RADAR_API_URL);
        if (!r.ok) throw new Error(`API fout ${r.status}`);
        const data = await r.json();
        if (data.error) throw new Error(data.error);

        radarFrames = data.frames;
        radarIndex  = 0;

        const schuif = document.getElementById("radar-schuif");
        schuif.max   = radarFrames.length - 1;
        schuif.value = 0;

        toonRadarFrame(0);
        melding.style.display = "none";
        radarAnimatieStartStop(); // automatisch starten
    } catch (fout) {
        melding.textContent = "Kon radardata niet laden. Probeer het later opnieuw.";
        console.error("Radar fout:", fout);
    }
}

function toonRadarFrame(index) {
    if (!radarFrames.length) return;
    radarIndex = index;
    const frame = radarFrames[index];

    if (radarOverlay) radarKaart.removeLayer(radarOverlay);
    radarOverlay = L.imageOverlay(
        "data:image/png;base64," + frame.png_b64,
        RADAR_BOUNDS,
        { opacity: 0.8, interactive: false }
    ).addTo(radarKaart);

    // Marker bovenop de overlay houden
    if (radarMarker) radarMarker.bringToFront();

    document.getElementById("radar-tijd").textContent = frame.tijd;
    document.getElementById("radar-schuif").value = index;
}

function radarAnimatieStartStop() {
    const knop = document.getElementById("radar-afspelen");
    if (radarSpeelt) {
        clearInterval(radarTimer);
        radarSpeelt = false;
        knop.textContent = "▶";
    } else {
        radarSpeelt = true;
        knop.textContent = "⏸";
        radarTimer = setInterval(() => {
            const volgend = (radarIndex + 1) % radarFrames.length;
            if (volgend === 0) {
                // Korte pauze aan het einde van de laps
                clearInterval(radarTimer);
                setTimeout(() => {
                    toonRadarFrame(0);
                    radarTimer = setInterval(() => {
                        toonRadarFrame((radarIndex + 1) % radarFrames.length);
                    }, 400);
                }, 1200);
            } else {
                toonRadarFrame(volgend);
            }
        }, 400);
    }
}

// ─── Service worker updates ────────────────────────────────────────────────

if ("serviceWorker" in navigator) {
    let al_aan_het_verversen = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (al_aan_het_verversen) return;
        al_aan_het_verversen = true;
        window.location.reload();
    });
}

// ─── Opstarten ─────────────────────────────────────────────────────────────

function init() {
    startGolvenAnimatie();

    document.getElementById("locatie-naam").textContent = huidigeLocatie.naam;

    document.getElementById("overlay-sluiten").addEventListener("click", verbergDagOverlay);
    document.getElementById("dag-overlay").addEventListener("click", (e) => {
        if (e.target.id === "dag-overlay") verbergDagOverlay();
    });

    document.getElementById("locatie-knop").addEventListener("click", toonLocatieOverlay);
    document.getElementById("locatie-overlay-sluiten").addEventListener("click", verbergLocatieOverlay);
    document.getElementById("locatie-overlay").addEventListener("click", (e) => {
        if (e.target.id === "locatie-overlay") verbergLocatieOverlay();
    });
    document.getElementById("locatie-input").addEventListener("input", opZoekInput);

    document.getElementById("radar-afspelen").addEventListener("click", radarAnimatieStartStop);
    document.getElementById("radar-schuif").addEventListener("input", (e) => {
        if (radarSpeelt) radarAnimatieStartStop();
        toonRadarFrame(parseInt(e.target.value));
    });

    initRadarKaart();
    laadWeerData();
}

init();