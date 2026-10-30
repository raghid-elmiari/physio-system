# Production image for the Spring Boot API (Render, Railway, Fly.io, or any Docker host).
# Build:  docker build -t physio-backend backend
# Run:    docker run -p 8080:8080 --env-file backend/.env.production physio-backend

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B -DskipTests package

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 physio
COPY --from=build /app/target/assistant-*.jar app.jar
USER physio
ENV SPRING_PROFILES_ACTIVE=postgres \
    JAVA_OPTS="-XX:MaxRAMPercentage=75"
EXPOSE 8080
# Hosting platforms set PORT; fall back to 8080 locally.
CMD ["sh", "-c", "exec java $JAVA_OPTS -Dserver.port=${PORT:-8080} -jar app.jar"]
