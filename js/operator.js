/*
 * Modo operador: oculto por padrão. Ligue com ?operador=1 na URL (vale para a
 * sessão da aba) e desligue com ?operador=0 ou pelo botão "Sair".
 *
 * ATENÇÃO: isto só esconde controles da interface do cidadão — NÃO é controle
 * de acesso. Os limiares ajustados aqui valem apenas neste navegador e apenas
 * com o modo ligado; o público sempre vê os limiares oficiais do servidor.
 */
import { effectiveThresholds, store, thresholdsDiffer } from "./state.js";
import { paintRange, showToast } from "./ui.js";
import { $, storage } from "./util.js";
const OPERATOR_KEY = "climasp_operator";
const CUSTOM_KEY = "climasp_thresholds_custom";
function readOperatorFlag() {
    const param = new URLSearchParams(window.location.search).get("operador");
    if (param === "1" || param === "true")
        storage.set(OPERATOR_KEY, true, "session");
    if (param === "0" || param === "false")
        storage.remove(OPERATOR_KEY, "session");
    return storage.get(OPERATOR_KEY, false, "session") === true;
}
/** Limiares do operador mudam só a chuva; os cortes do índice de risco seguem os oficiais. */
function validCustom(value, riskCuts) {
    if (!value || typeof value !== "object")
        return null;
    const { red, orange, yellow } = value;
    if (![red, orange, yellow].every(Number.isFinite))
        return null;
    return yellow < orange && orange < red ? { red, orange, yellow, riskCuts } : null;
}
function renderLegend([thresholds, official, operator, custom, source]) {
    const { red: r, orange: o, yellow: y } = thresholds;
    $("#leg-red").textContent = `≥ ${r} mm/h`;
    $("#leg-orange").textContent = `${o}–${r - 1} mm/h`;
    $("#leg-yellow").textContent = `${y}–${o - 1} mm/h`;
    $("#leg-green").textContent = `0–${y - 1} mm/h`;
    const note = $("#legNote");
    const local = operator && thresholdsDiffer(custom, official);
    if (source === "sample") {
        note.textContent = "Cores ilustrativas: sem conexão, o mapa mostra dados de exemplo em cinza.";
        note.hidden = false;
    }
    else if (local) {
        note.textContent = `Limiares locais deste navegador (oficiais: ${official.yellow}/${official.orange}/${official.red} mm/h).`;
        note.hidden = false;
    }
    else {
        note.hidden = true;
    }
}
function syncSliders(thresholds) {
    $("#thrRed").value = thresholds.red;
    $("#thrOrange").value = thresholds.orange;
    $("#thrYellow").value = thresholds.yellow;
    for (const id of ["thrRed", "thrOrange", "thrYellow"])
        paintRange($(`#${id}`));
    syncSliderLabels();
}
function syncSliderLabels() {
    for (const id of ["thrRed", "thrOrange", "thrYellow"]) {
        $(`#${id}Val`).textContent = `${$(`#${id}`).value} mm/h`;
    }
}
export function initOperator() {
    store.set({
        operator: readOperatorFlag(),
        customThresholds: validCustom(storage.get(CUSTOM_KEY, null), store.get().officialThresholds.riskCuts),
    });
    // limiares oficiais (com os cortes do índice) chegam depois do servidor
    store.subscribe(s => s.officialThresholds, official => {
        const custom = store.get().customThresholds;
        if (custom && custom.riskCuts !== official.riskCuts)
            store.set({ customThresholds: { ...custom, riskCuts: official.riskCuts } });
    }, { immediate: false });
    store.subscribe(s => [s.operator, s.customThresholds, s.officialThresholds], ([operator, custom, official]) => {
        $("#thresholdSect").hidden = !operator;
        $("#operatorChip").hidden = !operator;
        const local = operator && thresholdsDiffer(custom, official);
        $("#operatorChipLocal").hidden = !local;
        $("#thrRestore").hidden = !local;
        if (operator)
            syncSliders(custom || official);
    });
    store.subscribe(s => [effectiveThresholds(s), s.officialThresholds, s.operator, s.customThresholds, s.source], renderLegend);
    for (const id of ["thrRed", "thrOrange", "thrYellow"])
        $(`#${id}`).addEventListener("input", syncSliderLabels);
    $("#thrApply").addEventListener("click", () => {
        const custom = validCustom({
            red: Number($("#thrRed").value),
            orange: Number($("#thrOrange").value),
            yellow: Number($("#thrYellow").value),
        }, store.get().officialThresholds.riskCuts);
        if (!custom) {
            showToast("Limiares inválidos: Médio < Alto < Crítico.");
            return;
        }
        const official = store.get().officialThresholds;
        const value = thresholdsDiffer(custom, official) ? custom : null;
        if (value)
            storage.set(CUSTOM_KEY, { red: value.red, orange: value.orange, yellow: value.yellow });
        else
            storage.remove(CUSTOM_KEY);
        store.set({ customThresholds: value });
        showToast(value ? "Limiares locais aplicados neste navegador." : "Limiares iguais aos oficiais.");
    });
    $("#thrRestore").addEventListener("click", () => {
        storage.remove(CUSTOM_KEY);
        store.set({ customThresholds: null });
        showToast("Limiares oficiais restaurados.");
    });
    $("#operatorExit").addEventListener("click", () => {
        storage.remove(OPERATOR_KEY, "session");
        const url = new URL(window.location.href);
        url.searchParams.delete("operador");
        window.history.replaceState(null, "", url);
        store.set({ operator: false });
    });
}
