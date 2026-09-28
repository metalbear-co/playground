FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:21-jre
RUN useradd --uid 65532 --create-home --shell /usr/sbin/nologin app
WORKDIR /app
COPY --from=build /src/target/profile-srvc.jar /app/profile-srvc.jar
USER 65532
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/profile-srvc.jar"]
