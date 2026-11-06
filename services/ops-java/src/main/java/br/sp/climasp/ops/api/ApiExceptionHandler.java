package br.sp.climasp.ops.api;

import br.sp.climasp.ops.domain.OpsErrors.Conflict;
import br.sp.climasp.ops.domain.OpsErrors.NotFound;
import jakarta.validation.ConstraintViolationException;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/** Erros no formato do FastAPI: {"detail": "..."} (404, 409) e 422 para entrada inválida. */
@RestControllerAdvice
public class ApiExceptionHandler {

    @ExceptionHandler(NotFound.class)
    ResponseEntity<Map<String, Object>> notFound(NotFound e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("detail", e.getMessage()));
    }

    @ExceptionHandler(Conflict.class)
    ResponseEntity<Map<String, Object>> conflict(Conflict e) {
        return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("detail", e.getMessage()));
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    ResponseEntity<Map<String, Object>> invalidBody(MethodArgumentNotValidException e) {
        List<Map<String, Object>> errors = e.getBindingResult().getFieldErrors().stream()
                .map(f -> Map.<String, Object>of("loc", List.of("body", f.getField()),
                        "msg", String.valueOf(f.getDefaultMessage()), "type", "value_error"))
                .toList();
        return ResponseEntity.unprocessableEntity().body(Map.of("detail", errors));
    }

    @ExceptionHandler({ConstraintViolationException.class, HandlerMethodValidationException.class,
            MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class,
            HttpMessageNotReadableException.class})
    ResponseEntity<Map<String, Object>> invalid(Exception e) {
        return ResponseEntity.unprocessableEntity().body(Map.of("detail", "Entrada inválida: " + e.getMessage()));
    }
}
