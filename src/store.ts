/*
 * Store central de estado, sem framework.
 *
 *   const store = createStore({ a: 1 });
 *   store.subscribe(s => s.a, (a, prev) => render(a));   // roda já e a cada mudança de `a`
 *   store.set({ a: 2 });                                  // ou store.set(s => ({ a: s.a + 1 }))
 *
 * O seletor pode devolver um valor ou um array de valores; o assinante só é
 * chamado quando algum deles muda (comparação rasa por identidade). Por isso o
 * estado é tratado como imutável: para mudar `regions`, crie um objeto novo.
 */

export type Listener<S> = (state: S) => void;
/** Tupla devolvida pelo seletor, sem `readonly`, para callbacks como `([a, b]) => …`. */
export type Selected<T> = T extends readonly unknown[] ? { -readonly [K in keyof T]: T[K] } : T;
export type Patch<S> = Partial<S> | ((state: S) => Partial<S> | null | undefined | void);

export interface Store<S extends object> {
    get(): S;
    set(patch: Patch<S>): void;
    /** `const T`: um seletor que devolve [a, b] é tipado como tupla, e o callback recebe cada tipo. */
    subscribe<const T>(
        selector: (state: S) => T,
        callback: (value: Selected<T>, previous: Selected<T> | undefined, state: S) => void,
        options?: { immediate?: boolean },
    ): () => boolean;
}

function sameSelection(a: unknown, b: unknown): boolean {
    if (Object.is(a, b)) return true;
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, i) => Object.is(value, b[i]));
}

export function createStore<S extends object>(initialState: S): Store<S> {
    let state = initialState;
    const listeners = new Set<Listener<S>>();
    let notifying = false;
    let pending = false;

    function notify() {
        // Um `set` feito dentro de um assinante é aplicado e propagado depois
        // que a rodada atual terminar, para todos verem o estado em ordem.
        if (notifying) { pending = true; return; }
        notifying = true;
        try {
            do {
                pending = false;
                for (const listener of Array.from(listeners)) listener(state);
            } while (pending);
        } finally {
            notifying = false;
        }
    }

    return {
        get: () => state,

        set(patch) {
            const next = typeof patch === "function" ? patch(state) : patch;
            if (!next) return;
            let changed = false;
            for (const key of Object.keys(next) as (keyof S)[]) {
                if (!Object.is(state[key], next[key])) { changed = true; break; }
            }
            if (!changed) return;
            state = { ...state, ...next };
            notify();
        },

        subscribe(selector, callback, { immediate = true } = {}) {
            let last = selector(state);
            const listener: Listener<S> = current => {
                const value = selector(current);
                if (sameSelection(value, last)) return;
                const previous = last;
                last = value;
                callback(value as never, previous as never, current);
            };
            listeners.add(listener);
            if (immediate) callback(last as never, undefined, state);
            return () => listeners.delete(listener);
        },
    };
}
