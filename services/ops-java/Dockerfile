# ClimaSP — serviço de operação (Java 21 + Spring Boot). Build em duas etapas, imagem final só com JRE.
# Contexto de build: a RAIZ do repositório (a imagem leva data/geo, importado para o PostGIS).
#   docker build -f services/ops-java/Dockerfile .
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY services/ops-java/pom.xml .
RUN mvn -B -q dependency:go-offline
COPY services/ops-java/src ./src
RUN mvn -B -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 climasp && mkdir -p /app/graph-cache && chown climasp /app/graph-cache
COPY --from=build /src/target/climasp-ops-*.jar /app/climasp-ops.jar
COPY data/geo /data/geo
USER climasp
ENV GEO_DATA_DIR=/data/geo GRAPH_CACHE_DIR=/app/graph-cache JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s CMD wget -qO- http://localhost:8081/actuator/health/readiness || exit 1
ENTRYPOINT ["sh", "-c", "exec java $JAVA_OPTS -jar /app/climasp-ops.jar"]
