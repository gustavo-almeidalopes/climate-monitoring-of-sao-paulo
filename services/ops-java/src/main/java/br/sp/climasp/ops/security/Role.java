package br.sp.climasp.ops.security;

/** Perfis da Fase 3. Operador inclui o que o gestor pode (leitura de indicadores). */
public enum Role {
    GESTOR("gestor", 1),
    OPERADOR("operador", 2);

    public final String label;
    public final int rank;

    Role(String label, int rank) {
        this.label = label;
        this.rank = rank;
    }
}
