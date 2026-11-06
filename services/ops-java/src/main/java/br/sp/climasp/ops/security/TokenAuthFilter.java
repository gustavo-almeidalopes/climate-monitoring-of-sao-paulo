package br.sp.climasp.ops.security;

import br.sp.climasp.ops.config.OpsProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Perfis por token, com as mesmas regras e mensagens do backend Python (app/core/security.py):
 * sem tokens configurados -> 503; sem credencial -> 401 "Credencial ausente."; token errado -> 401
 * "Credencial inválida."; perfil insuficiente -> 403 "Ação restrita ao perfil X.". Leitura (GET)
 * exige gestor ou acima; escrita exige operador. Comparação em tempo constante.
 */
public class TokenAuthFilter extends OncePerRequestFilter {

    private final OpsProperties props;
    private final ObjectMapper json;

    public TokenAuthFilter(OpsProperties props, ObjectMapper json) {
        this.props = props;
        this.json = json;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/v1/ops/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse resp, FilterChain chain)
            throws ServletException, IOException {
        if (!props.opsConfigured()) {
            deny(resp, 503, "Operação não configurada: defina OPERATOR_TOKEN e MANAGER_TOKEN no servidor.");
            return;
        }
        String header = req.getHeader("Authorization");
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            resp.setHeader("WWW-Authenticate", "Bearer");
            deny(resp, 401, "Credencial ausente.");
            return;
        }
        Role role = roleFor(header.substring(7).trim());
        if (role == null) {
            resp.setHeader("WWW-Authenticate", "Bearer");
            deny(resp, 401, "Credencial inválida.");
            return;
        }
        Role needed = required(req);
        if (role.rank < needed.rank) {
            deny(resp, 403, "Ação restrita ao perfil " + needed.label + ".");
            return;
        }
        List<SimpleGrantedAuthority> authorities = new ArrayList<>();
        for (Role r : Role.values()) if (r.rank <= role.rank) authorities.add(new SimpleGrantedAuthority("ROLE_" + r.name()));
        var auth = new UsernamePasswordAuthenticationToken(role.label, null, authorities);
        SecurityContextHolder.getContext().setAuthentication(auth);
        chain.doFilter(req, resp);
    }

    /** /me: qualquer perfil; leitura: gestor; o resto (despacho, status, ocorrências): operador. */
    static Role required(HttpServletRequest req) {
        String path = req.getRequestURI();
        if (path.equals("/api/v1/ops/me")) return Role.GESTOR;
        return HttpMethod.GET.matches(req.getMethod()) ? Role.GESTOR : Role.OPERADOR;
    }

    Role roleFor(String token) {
        if (matches(token, props.operatorToken())) return Role.OPERADOR;
        if (matches(token, props.managerToken())) return Role.GESTOR;
        return null;
    }

    private static boolean matches(String given, String expected) {
        if (expected == null || expected.isBlank()) return false;
        return MessageDigest.isEqual(given.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
    }

    private void deny(HttpServletResponse resp, int status, String detail) throws IOException {
        resp.setStatus(status);
        resp.setContentType(MediaType.APPLICATION_JSON_VALUE);
        resp.setCharacterEncoding("UTF-8");
        json.writeValue(resp.getOutputStream(), Map.of("detail", detail));
    }
}
