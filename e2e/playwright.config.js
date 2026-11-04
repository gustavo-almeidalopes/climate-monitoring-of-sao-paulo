// Testes ponta a ponta do front-end estático do ClimaSP.
// O site é servido como arquivos estáticos (igual ao deploy da Vercel) e todas
// as dependências de rede — API, tiles, Leaflet, Nominatim, GeoJSON — são
// simuladas em support/mocks.js, para os testes não dependerem de internet.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT || 4173);

export default defineConfig({
    testDir: "./tests",
    timeout: 30_000,
    expect: { timeout: 7_000 },
    fullyParallel: true,
    reporter: [["list"]],
    globalSetup: "./support/global-setup.js",
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: "pt-BR",
        timezoneId: "America/Sao_Paulo",
        trace: "retain-on-failure",
    },
    projects: [
        // No Mac (scripts/ios/test.sh): também roda no WebKit com perfil de iPhone — o motor do Safari.
        ...(process.env.E2E_WEBKIT === "1" ? [{ name: "iphone-webkit", use: { ...devices["iPhone 15"] } }] : []),
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
        {
            name: "celular",
            use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true },
        },
    ],
    webServer: {
        command: `python3 -m http.server ${PORT} --bind 127.0.0.1 --directory ${process.env.E2E_ROOT || ".."}`,
        url: `http://127.0.0.1:${PORT}/index.html`,
        reuseExistingServer: !process.env.CI,
        stdout: "ignore",
    },
});
