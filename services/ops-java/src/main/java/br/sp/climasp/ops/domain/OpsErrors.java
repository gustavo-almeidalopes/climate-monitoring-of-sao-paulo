package br.sp.climasp.ops.domain;

/** Erros de negócio, traduzidos para HTTP como no FastAPI (404 e 409 com {"detail": ...}). */
public final class OpsErrors {
    private OpsErrors() {
    }

    public static class NotFound extends RuntimeException {
        public NotFound(String message) {
            super(message);
        }
    }

    public static class Conflict extends RuntimeException {
        public Conflict(String message) {
            super(message);
        }
    }
}
