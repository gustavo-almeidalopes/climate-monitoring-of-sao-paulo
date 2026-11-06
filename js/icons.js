/* Ícones SVG do sprite definido no index.html (<symbol id="i-...">). */
export function icon(name, className = "") {
    return `<svg class="i ${className}" aria-hidden="true" focusable="false"><use href="#i-${name}"></use></svg>`;
}
/** Ícone de condição do tempo para o popup, a partir do nível de perigo e do vento. */
export function weatherIconName(level, windKmh) {
    if (level === "critical")
        return "cloud-lightning";
    if (level === "high")
        return "cloud-rain";
    if (level === "medium")
        return "cloud-drizzle";
    if (windKmh != null && windKmh > 35)
        return "wind";
    return "cloud";
}
