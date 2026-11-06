package br.sp.climasp.ops;

import static org.assertj.core.api.Assertions.assertThat;

import br.sp.climasp.ops.domain.LatLng;
import br.sp.climasp.ops.routing.EstimateRouter;
import br.sp.climasp.ops.routing.GraphHopperRouter;
import br.sp.climasp.ops.routing.TravelRouter.Route;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * GraphHopper embutido sobre uma malha FICTÍCIA 4×4 (src/test/resources/malha-ficticia.osm):
 * roteia por ruas, devolve geometria e calcula isócronas por árvore de menor caminho.
 */
class GraphHopperRouterTest {

    @TempDir
    static Path cache;
    static GraphHopperRouter gh;

    static final LatLng A = new LatLng(-23.500, -46.640);   // canto sudoeste
    static final LatLng B = new LatLng(-23.485, -46.625);   // canto nordeste
    static final LatLng FORA = new LatLng(-22.9, -43.2);    // longe da malha

    @BeforeAll
    static void build() throws Exception {
        String osm = Path.of(GraphHopperRouterTest.class.getResource("/malha-ficticia.osm").toURI()).toString();
        gh = new GraphHopperRouter(osm, cache.resolve("gh").toString());
    }

    @AfterAll
    static void close() {
        gh.close();
    }

    @Test
    void tempoPorRuasMaiorQueALinhaRetaEMenorQueAEstimativa() {
        double minutes = gh.minutesTo(List.of(A), B).minutes().get(0);
        assertThat(gh.minutesTo(List.of(A), B).estimated()).isFalse();
        // percurso em "L" (~3,3 km) em vias de 25–65 km/h
        assertThat(minutes).isBetween(2.0, 12.0);
        List<Route> routes = gh.routes(A, B);
        assertThat(routes).isNotEmpty();
        Route best = routes.get(0);
        assertThat(best.estimated()).isFalse();
        assertThat(best.km()).isGreaterThan(A.kmTo(B)); // por ruas é mais longe que em linha reta
        assertThat(best.coords().size()).isGreaterThan(2);
        assertThat(best.coords().get(0)[0]).isCloseTo(A.lat(), org.assertj.core.data.Offset.offset(0.001));
    }

    @Test
    void isocronasPorArvoreDeMenorCaminho() {
        var t = gh.minutesFrom(A, List.of(A, B, FORA), 60);
        assertThat(t.source()).isEqualTo("graphhopper");
        assertThat(t.minutes().get(0)).isLessThan(0.5);
        assertThat(t.minutes().get(1)).isCloseTo(gh.minutesTo(List.of(A), B).minutes().get(0), org.assertj.core.data.Offset.offset(1.0));
        assertThat(t.minutes().get(2)).isNull(); // fora da malha: sem rota (não inventa tempo)
        var curto = gh.minutesFrom(A, List.of(B), 0.5);
        assertThat(curto.minutes().get(0)).isNull(); // além do limite de tempo
    }

    @Test
    void foraDaMalhaCaiNaEstimativaRotulada() {
        var t = gh.minutesTo(List.of(FORA), B);
        assertThat(t.estimated()).isTrue();
        assertThat(t.minutes().get(0)).isCloseTo(EstimateRouter.estimateMinutes(FORA, B), org.assertj.core.data.Offset.offset(0.01));
        assertThat(gh.routes(FORA, B).get(0).estimated()).isTrue();
    }
}
