// ─── Instellingen ──────────────────────────────────────────────────────────

const STANDAARD_LOCATIE = {
    naam: "Amersfoort",
    latitude: 52.155,
    longitude: 5.3875,
    timezone: "Europe/Amsterdam",
};

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
    const beschrijving = weercode[0];
    const emoji = isNacht ? weercode[2] : weercode[1];
    return [beschrijving, emoji];
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
    url.searchParams.set("hourly", "temperature_2m,rain,showers,apparent_temperature,relative_humidity_2m,cloud_cover,weather_code");
    url.searchParams.set("current", "temperature_2m,apparent_temperature,rain,showers,weather_code");

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API fout: ${response.status}`);
    }
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
    if (!response.ok) {
        throw new Error(`Pollen API fout: ${response.status}`);
    }
    return response.json();
}

// Grenzen gebaseerd op gangbare Europese pollen-indexen (grove benadering,
// pollensoorten verschillen in gevoeligheid maar dit geeft een redelijk algemeen beeld)
function pollenNiveau(totaal) {
    if (totaal === null || totaal === undefined || Number.isNaN(totaal)) {
        return { label: "Onbekend", emoji: "❓" };
    }
    if (totaal < 10)  return { label: "Laag", emoji: "🟢" };
    if (totaal < 30)  return { label: "Matig", emoji: "🟡" };
    if (totaal < 70)  return { label: "Hoog", emoji: "🟠" };
    return { label: "Zeer hoog", emoji: "🔴" };
}

function parsePollenPerUur(pollenData) {
    const h = pollenData.hourly;
    const soorten = ["alder_pollen", "birch_pollen", "grass_pollen", "mugwort_pollen", "olive_pollen", "ragweed_pollen"];

    const totalenPerUur = [];
    for (let i = 0; i < h.time.length; i++) {
        let totaal = 0;
        soorten.forEach(soort => {
            if (h[soort] && h[soort][i] !== null && h[soort][i] !== undefined) {
                totaal += h[soort][i];
            }
        });
        totalenPerUur.push({
            tijdISO: h.time[i],
            totaal: Math.round(totaal * 10) / 10,
        });
    }
    return totalenPerUur;
}

function vindPollenVoorTijd(pollenPerUur, isoTijd) {
    const doel = new Date(isoTijd).getTime();
    let dichtstbij = pollenPerUur[0];
    let kleinsteVerschil = Infinity;

    pollenPerUur.forEach(punt => {
        const verschil = Math.abs(new Date(punt.tijdISO).getTime() - doel);
        if (verschil < kleinsteVerschil) {
            kleinsteVerschil = verschil;
            dichtstbij = punt;
        }
    });

    return dichtstbij ? dichtstbij.totaal : null;
}

function vindPollenVoorDag(pollenPerUur, datumISO) {
    const dagDatum = datumISO.split("T")[0];
    const punten = pollenPerUur.filter(p => p.tijdISO.split("T")[0] === dagDatum);
    if (punten.length === 0) return null;

    // Gebruik het hoogste punt van de dag als representatief dagniveau
    const hoogste = Math.max(...punten.map(p => p.totaal));
    return hoogste;
}

// ─── Locatie zoeken (geocoding) ─────────────────────────────────────────

async function zoekLocaties(zoekterm) {
    const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", zoekterm);
    url.searchParams.set("count", 5);
    url.searchParams.set("language", "nl");

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Geocoding fout: ${response.status}`);
    }
    const data = await response.json();
    return data.results || [];
}

function veranderLocatie(nieuweLocatie) {
    huidigeLocatie = nieuweLocatie;
    localStorage.setItem("weerapp-locatie", JSON.stringify(nieuweLocatie));
    document.getElementById("locatie-naam").textContent = nieuweLocatie.naam;
    laadWeerData();
}

// ─── Data verwerken naar nette objecten ───────────────────────────────────

function parseHuidig(data) {
    const c = data.current;
    const h = data.hourly;
    const nu = new Date();

    // Zoek het hourly-datapunt dat het dichtst bij het huidige moment ligt.
    // De "current" data van de API kan soms een kwartier verlopen zijn,
    // het hourly-overzicht is net zo vers maar net iets directer te matchen.
    let dichtstbijIndex = 0;
    let kleinsteVerschil = Infinity;
    for (let i = 0; i < h.time.length; i++) {
        const verschil = Math.abs(new Date(h.time[i]).getTime() - nu.getTime());
        if (verschil < kleinsteVerschil) {
            kleinsteVerschil = verschil;
            dichtstbijIndex = i;
        }
    }

    const weercode = h.weather_code[dichtstbijIndex];
    const [beschrijving, emoji] = weercodeInfo(weercode);

    return {
        tijd: naarDatumTijdString(nu.toISOString()),
        temperatuur: Math.round(c.temperature_2m * 10) / 10,
        gevoelstemperatuur: Math.round(c.apparent_temperature * 10) / 10,
        regen: Math.round(h.rain[dichtstbijIndex] * 10) / 10,
        buien: Math.round(h.showers[dichtstbijIndex] * 10) / 10,
        beschrijving,
        emoji,
    };
}

function parseUurlijks(data) {
    const h = data.hourly;
    const d = data.daily;
    const nu = new Date();

    // Bouw een snelle opzoektabel: datum-string → { opgang, ondergang } als timestamps
    const zontijden = {};
    for (let i = 0; i < d.time.length; i++) {
        zontijden[d.time[i]] = {
            opgang:     new Date(d.sunrise[i]).getTime(),
            ondergang:  new Date(d.sunset[i]).getTime(),
        };
    }

    const uurLijst = [];
    for (let i = 0; i < h.time.length; i++) {
        const tijdstip = new Date(h.time[i]);
        if (tijdstip < nu) continue;

        const dagDatum = h.time[i].split("T")[0];
        const zon = zontijden[dagDatum];
        const ts = tijdstip.getTime();
        const isNacht = zon ? (ts < zon.opgang || ts >= zon.ondergang) : false;

        uurLijst.push({
            tijd:               naarUurString(h.time[i]),
            temperatuur:        Math.round(h.temperature_2m[i] * 10) / 10,
            gevoelstemperatuur: Math.round(h.apparent_temperature[i] * 10) / 10,
            regen:              Math.round(h.rain[i] * 10) / 10,
            buien:              Math.round(h.showers[i] * 10) / 10,
            luchtvochtigheid:   Math.round(h.relative_humidity_2m[i]),
            bewolking:          Math.round(h.cloud_cover[i]),
            weercode:           h.weather_code[i],
            isNacht,
        });
    }
    return uurLijst;
}

function parseAlleUren(data) {
    const h = data.hourly;
    const d = data.daily;

    // Zelfde opzoektabel als hierboven
    const zontijden = {};
    for (let i = 0; i < d.time.length; i++) {
        zontijden[d.time[i]] = {
            opgang:     new Date(d.sunrise[i]).getTime(),
            ondergang:  new Date(d.sunset[i]).getTime(),
        };
    }

    const uurLijst = [];
    for (let i = 0; i < h.time.length; i++) {
        const tijdstip = new Date(h.time[i]);
        const dagDatum = h.time[i].split("T")[0];
        const zon = zontijden[dagDatum];
        const ts = tijdstip.getTime();
        const isNacht = zon ? (ts < zon.opgang || ts >= zon.ondergang) : false;

        uurLijst.push({
            tijdISO:            h.time[i],
            tijd:               naarUurString(h.time[i]),
            temperatuur:        Math.round(h.temperature_2m[i] * 10) / 10,
            gevoelstemperatuur: Math.round(h.apparent_temperature[i] * 10) / 10,
            regen:              Math.round(h.rain[i] * 10) / 10,
            buien:              Math.round(h.showers[i] * 10) / 10,
            luchtvochtigheid:   Math.round(h.relative_humidity_2m[i]),
            bewolking:          Math.round(h.cloud_cover[i]),
            weercode:           h.weather_code[i],
            isNacht,
        });
    }
    return uurLijst;
}

function parseDagelijks(data) {
    const d = data.daily;

    const dagLijst = [];
    for (let i = 0; i < d.time.length; i++) {
        const [beschrijving, emoji] = weercodeInfo(d.weather_code[i]);
        dagLijst.push({
            datumISO: d.time[i],
            datum: naarDagString(d.time[i]),
            maxTemp: Math.round(d.temperature_2m_max[i] * 10) / 10,
            minTemp: Math.round(d.temperature_2m_min[i] * 10) / 10,
            regenSom: Math.round(d.rain_sum[i] * 10) / 10,
            zonsopgang: naarUurString(d.sunrise[i]),
            zonsondergang: naarUurString(d.sunset[i]),
            beschrijving,
            emoji,
        });
    }
    return dagLijst;
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
}

function toonPollenHuidig(pollenTotaal) {
    const niveau = pollenNiveau(pollenTotaal);
    document.getElementById("huidig-pollen").textContent = `${niveau.emoji} ${niveau.label}`;
}

function toonUurlijks(uurLijst) {
    const container = document.getElementById("uur-rij");
    container.innerHTML = "";

    // Toon alleen de eerste 24 uur
    uurLijst.slice(0, 24).forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode, uur.isNacht);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart" + (uur.isNacht ? " uur-kaart-nacht" : "");
        kaart.innerHTML = `
            <div class="uur-tijd">${uur.tijd}</div>
            <div class="uur-emoji">${emoji}</div>
            <div class="uur-temp">${uur.temperatuur}°</div>
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
        const pollenVoorDag = vindPollenVoorDag(huidigePollenPerUur, dag.datumISO);
        const niveau = pollenNiveau(pollenVoorDag);
        document.getElementById("overlay-pollen").textContent = `${niveau.emoji} ${niveau.label}`;
    } else {
        document.getElementById("overlay-pollen").textContent = "Onbekend";
    }

    // Filter de uren die bij deze dag horen (zelfde datum, voor de "T")
    const dagDatum = dag.datumISO.split("T")[0];
    const urenVanDeDag = alleUren.filter(uur => uur.tijdISO.split("T")[0] === dagDatum);

    const urenContainer = document.getElementById("overlay-uren");
    urenContainer.innerHTML = "";
    urenVanDeDag.forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode, uur.isNacht);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart" + (uur.isNacht ? " uur-kaart-nacht" : "");
        kaart.innerHTML = `
            <div class="uur-tijd">${uur.tijd}</div>
            <div class="uur-emoji">${emoji}</div>
            <div class="uur-temp">${uur.temperatuur}°</div>
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
        const lagen = [
            { alpha: 0.35, offsetY: 0 },
            { alpha: 0.2, offsetY: 40 },
        ];

        lagen.forEach(laag => {
            ctx.strokeStyle = `rgba(255, 255, 255, ${laag.alpha})`;
            ctx.lineWidth = 1.8;

            let y = laag.offsetY;
            while (y < canvas.height + 60) {
                ctx.beginPath();
                for (let x = -golfBreedte; x <= canvas.width + golfBreedte; x += 4) {
                    const fase = (x / golfBreedte) * Math.PI * 2;
                    const gy = y + Math.sin(fase) * 18;
                    if (x === -golfBreedte) {
                        ctx.moveTo(x, gy);
                    } else {
                        ctx.lineTo(x, gy);
                    }
                }
                ctx.stroke();
                y += 55;
            }
        });
    }

    window.addEventListener("resize", resize);
    resize();
}

async function laadWeerData() {
    try {
        const data = await haalWeerOp();
        const huidig = parseHuidig(data);
        const uurlijks = parseUurlijks(data);
        const dagelijks = parseDagelijks(data);
        const alleUren = parseAlleUren(data);

        toonHuidig(huidig);
        toonUurlijks(uurlijks);
        toonDagelijks(dagelijks, alleUren);

        // Pollen apart ophalen — als dit faalt laten we de rest van de app
        // gewoon werken, pollen is een "nice to have", geen kernfunctie
        try {
            const pollenData = await haalPollenOp();
            const pollenPerUur = parsePollenPerUur(pollenData);
            huidigePollenPerUur = pollenPerUur;

            const nu = new Date().toISOString();
            const pollenNu = vindPollenVoorTijd(pollenPerUur, nu);
            toonPollenHuidig(pollenNu);
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

    // Wacht even na het typen voordat we daadwerkelijk zoeken (debounce),
    // zodat we niet bij elke toetsaanslag een aanvraag versturen
    zoekTimer = setTimeout(async () => {
        const resultatenContainer = document.getElementById("locatie-resultaten");
        resultatenContainer.innerHTML = `<p class="locatie-melding">Zoeken...</p>`;

        try {
            const resultaten = await zoekLocaties(zoekterm);

            if (resultaten.length === 0) {
                resultatenContainer.innerHTML = `<p class="locatie-melding">Geen plaatsen gevonden</p>`;
                return;
            }

            resultatenContainer.innerHTML = "";
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
                resultatenContainer.appendChild(knop);
            });
        } catch (fout) {
            console.error("Kon locaties niet zoeken:", fout);
            resultatenContainer.innerHTML = `<p class="locatie-melding">Zoeken mislukt</p>`;
        }
    }, 400);
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

    // Toon de opgeslagen of standaard locatie-naam direct
    document.getElementById("locatie-naam").textContent = huidigeLocatie.naam;

    // Sluit-knop en klik-buiten-overlay om dag-overlay te sluiten
    document.getElementById("overlay-sluiten").addEventListener("click", verbergDagOverlay);
    document.getElementById("dag-overlay").addEventListener("click", (event) => {
        if (event.target.id === "dag-overlay") {
            verbergDagOverlay();
        }
    });

    // Locatie-overlay bediening
    document.getElementById("locatie-knop").addEventListener("click", toonLocatieOverlay);
    document.getElementById("locatie-overlay-sluiten").addEventListener("click", verbergLocatieOverlay);
    document.getElementById("locatie-overlay").addEventListener("click", (event) => {
        if (event.target.id === "locatie-overlay") {
            verbergLocatieOverlay();
        }
    });
    document.getElementById("locatie-input").addEventListener("input", opZoekInput);

    laadWeerData();
}

init();