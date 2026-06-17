const CACHE_NAAM = "weer-app-v3";
const BESTANDEN_OM_TE_CACHEN = [
    "./",
    "./index.html",
    "./stijl.css",
    "./script.js",
    "./manifest.json",
    "./icoon-192.png",
    "./icoon-512.png",
];

// Bij installatie: cache de basisbestanden
self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAAM).then((cache) => {
            return cache.addAll(BESTANDEN_OM_TE_CACHEN);
        })
    );
});

// Bij elke aanvraag: probeer eerst de cache, anders het netwerk
self.addEventListener("fetch", (event) => {
    // Laat API aanroepen (open-meteo) altijd via het netwerk gaan, niet cachen
    if (event.request.url.includes("api.open-meteo.com")) {
        return;
    }

    event.respondWith(
        caches.match(event.request).then((gecached) => {
            return gecached || fetch(event.request);
        })
    );
});

// Oude caches opruimen bij een nieuwe versie
self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then((namen) => {
            return Promise.all(
                namen
                    .filter((naam) => naam !== CACHE_NAAM)
                    .map((naam) => caches.delete(naam))
            );
        })
    );
});
