// Baixa (uma vez) o GeoJSON real dos distritos usado pelo site e guarda em
// .cache/. Sem rede, os testes usam um GeoJSON sintético (support/mocks.js).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_FILE = path.join(here, "..", ".cache", "distritos-sp.geojson");
const URL = "https://raw.githubusercontent.com/codigourbano/distritos-sp/master/distritos-sp.geojson";

export default async function globalSetup() {
    if (fs.existsSync(CACHE_FILE)) return;
    try {
        const resp = await fetch(URL, { signal: AbortSignal.timeout(20_000) });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
        fs.writeFileSync(CACHE_FILE, Buffer.from(await resp.arrayBuffer()));
    } catch (err) {
        console.warn(`[e2e] GeoJSON real indisponível (${err.message}); usando polígonos sintéticos.`);
    }
}
