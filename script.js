// ─── Instellingen ──────────────────────────────────────────────────────────

const LATITUDE = 52.155;
const LONGITUDE = 5.3875;
const TIMEZONE = "Europe/Amsterdam";

// ─── Weercodes → beschrijving + emoji ─────────────────────────────────────

const WEERCODES = {
    0:  ["Heldere hemel", "☀️"],
    1:  ["Overwegend helder", "🌤️"],
    2:  ["Gedeeltelijk bewolkt", "⛅"],
    3:  ["Bewolkt", "☁️"],
    45: ["Mist", "🌫️"],
    48: ["IJsmist", "🌫️"],
    51: ["Lichte miezer", "🌦️"],
    53: ["Matige miezer", "🌦️"],
    55: ["Zware miezer", "🌧️"],
    61: ["Lichte regen", "🌧️"],
    63: ["Matige regen", "🌧️"],
    65: ["Zware regen", "🌧️"],
    71: ["Lichte sneeuw", "🌨️"],
    73: ["Matige sneeuw", "🌨️"],
    75: ["Zware sneeuw", "❄️"],
    77: ["Ijskorrels", "🌨️"],
    80: ["Lichte buien", "🌦️"],
    81: ["Matige buien", "🌧️"],
    82: ["Zware buien", "⛈️"],
    85: ["Lichte sneeuwbuien", "🌨️"],
    86: ["Zware sneeuwbuien", "❄️"],
    95: ["Onweer", "⛈️"],
    96: ["Onweer met hagel", "⛈️"],
    99: ["Zwaar onweer met hagel", "⛈️"],
};

function weercodeInfo(code) {
    return WEERCODES[code] || ["Onbekend", "❓"];
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
    url.searchParams.set("latitude", LATITUDE);
    url.searchParams.set("longitude", LONGITUDE);
    url.searchParams.set("timezone", TIMEZONE);
    url.searchParams.set("daily", "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,rain_sum");
    url.searchParams.set("hourly", "temperature_2m,rain,showers,apparent_temperature,relative_humidity_2m,cloud_cover,weather_code");
    url.searchParams.set("current", "temperature_2m,apparent_temperature,rain,showers,weather_code");

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`API fout: ${response.status}`);
    }
    return response.json();
}

// ─── Data verwerken naar nette objecten ───────────────────────────────────

function parseHuidig(data) {
    const c = data.current;
    const [beschrijving, emoji] = weercodeInfo(c.weather_code);

    return {
        tijd: naarDatumTijdString(c.time),
        temperatuur: Math.round(c.temperature_2m * 10) / 10,
        gevoelstemperatuur: Math.round(c.apparent_temperature * 10) / 10,
        regen: Math.round(c.rain * 10) / 10,
        buien: Math.round(c.showers * 10) / 10,
        beschrijving,
        emoji,
    };
}

function parseUurlijks(data) {
    const h = data.hourly;
    const nu = new Date();

    const uurLijst = [];
    for (let i = 0; i < h.time.length; i++) {
        const tijdstip = new Date(h.time[i]);
        if (tijdstip < nu) continue; // sla verleden uren over

        uurLijst.push({
            tijd: naarUurString(h.time[i]),
            temperatuur: Math.round(h.temperature_2m[i] * 10) / 10,
            gevoelstemperatuur: Math.round(h.apparent_temperature[i] * 10) / 10,
            regen: Math.round(h.rain[i] * 10) / 10,
            buien: Math.round(h.showers[i] * 10) / 10,
            luchtvochtigheid: Math.round(h.relative_humidity_2m[i]),
            bewolking: Math.round(h.cloud_cover[i]),
            weercode: h.weather_code[i],
        });
    }
    return uurLijst;
}

function parseAlleUren(data) {
    // Net als parseUurlijks, maar zonder uren uit het verleden te filteren.
    // Dit hebben we nodig om per dag het volledige uurlijkse overzicht te tonen
    // in de dag-detail overlay.
    const h = data.hourly;

    const uurLijst = [];
    for (let i = 0; i < h.time.length; i++) {
        uurLijst.push({
            tijdISO: h.time[i],
            tijd: naarUurString(h.time[i]),
            temperatuur: Math.round(h.temperature_2m[i] * 10) / 10,
            gevoelstemperatuur: Math.round(h.apparent_temperature[i] * 10) / 10,
            regen: Math.round(h.rain[i] * 10) / 10,
            buien: Math.round(h.showers[i] * 10) / 10,
            luchtvochtigheid: Math.round(h.relative_humidity_2m[i]),
            bewolking: Math.round(h.cloud_cover[i]),
            weercode: h.weather_code[i],
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

function toonUurlijks(uurLijst) {
    const container = document.getElementById("uur-rij");
    container.innerHTML = "";

    // Toon alleen de eerste 24 uur
    uurLijst.slice(0, 24).forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart";
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

    // Filter de uren die bij deze dag horen (zelfde datum, voor de "T")
    const dagDatum = dag.datumISO.split("T")[0];
    const urenVanDeDag = alleUren.filter(uur => uur.tijdISO.split("T")[0] === dagDatum);

    const urenContainer = document.getElementById("overlay-uren");
    urenContainer.innerHTML = "";
    urenVanDeDag.forEach(uur => {
        const [, emoji] = weercodeInfo(uur.weercode);
        const kaart = document.createElement("div");
        kaart.className = "uur-kaart";
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

async function init() {
    startGolvenAnimatie();

    // Sluit-knop en klik-buiten-overlay om te sluiten
    document.getElementById("overlay-sluiten").addEventListener("click", verbergDagOverlay);
    document.getElementById("dag-overlay").addEventListener("click", (event) => {
        if (event.target.id === "dag-overlay") {
            verbergDagOverlay();
        }
    });

    try {
        const data = await haalWeerOp();
        const huidig = parseHuidig(data);
        const uurlijks = parseUurlijks(data);
        const dagelijks = parseDagelijks(data);
        const alleUren = parseAlleUren(data);

        toonHuidig(huidig);
        toonUurlijks(uurlijks);
        toonDagelijks(dagelijks, alleUren);
    } catch (fout) {
        console.error("Kon weerdata niet ophalen:", fout);
        document.getElementById("huidig-beschrijving").textContent = "Kon weer niet laden";
    }
}

init();