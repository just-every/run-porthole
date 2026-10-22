# syntax=docker/dockerfile:1
# Build only the requested language target. The proxy CA is a build secret and
# never becomes an image layer. Runtime exports go to the owner's OTLP door.
FROM python:3.12-slim AS python
WORKDIR /app
COPY python/requirements.txt ./
RUN --mount=type=secret,id=proxy_ca,required=true PIP_CERT=/run/secrets/proxy_ca pip install --no-cache-dir -r requirements.txt
COPY python/app.py ./
CMD ["opentelemetry-instrument", "python", "app.py"]

FROM eclipse-temurin:21-jdk AS java
WORKDIR /app
RUN --mount=type=secret,id=proxy_ca,required=true curl --cacert /run/secrets/proxy_ca -fsSL https://repo1.maven.org/maven2/io/opentelemetry/javaagent/opentelemetry-javaagent/2.32.0/opentelemetry-javaagent-2.32.0.jar -o agent.jar && echo 'f787eb6c7f3d18e69a431e108a15278d25ee37f83d68b678f621e063f3988f82  agent.jar' | sha256sum -c -
COPY java/App.java ./
RUN javac --add-modules jdk.httpserver App.java
CMD ["java", "-javaagent:/app/agent.jar", "--add-modules", "jdk.httpserver", "App"]

FROM golang:1.25-bookworm AS go-build
WORKDIR /app
COPY go/ ./
RUN --mount=type=secret,id=proxy_ca,required=true SSL_CERT_FILE=/run/secrets/proxy_ca go mod tidy && CGO_ENABLED=0 go build -o app .
FROM debian:bookworm-slim AS go
WORKDIR /app
COPY --from=go-build /app/app ./
CMD ["./app"]

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet
WORKDIR /app
COPY dotnet/ ./
RUN --mount=type=secret,id=proxy_ca,required=true cp /run/secrets/proxy_ca /usr/local/share/ca-certificates/proxy.crt && update-ca-certificates && dotnet publish -c Release -o /app/out && rm /usr/local/share/ca-certificates/proxy.crt && update-ca-certificates
CMD ["dotnet", "/app/out/Polyglot.dll"]

FROM ruby:3.3-slim AS ruby
RUN --mount=type=secret,id=proxy_ca,required=true apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca update && apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca install -y --no-install-recommends gcc make libc6-dev && rm -rf /var/lib/apt/lists
WORKDIR /app
COPY ruby/Gemfile ./
RUN --mount=type=secret,id=proxy_ca,required=true SSL_CERT_FILE=/run/secrets/proxy_ca bundle install
COPY ruby/app.rb ./
CMD ["bundle", "exec", "ruby", "app.rb"]

FROM composer:2.8 AS composer
FROM php:8.3-cli AS php
WORKDIR /app
COPY --from=composer /usr/bin/composer /usr/local/bin/composer
RUN --mount=type=secret,id=proxy_ca,required=true curl --cacert /run/secrets/proxy_ca -fsSL https://pecl.php.net/get/opentelemetry-1.4.2.tgz -o /tmp/opentelemetry.tgz && pecl install /tmp/opentelemetry.tgz && docker-php-ext-enable opentelemetry && rm /tmp/opentelemetry.tgz
RUN --mount=type=secret,id=proxy_ca,required=true apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca update && apt-get -o Acquire::https::CaInfo=/run/secrets/proxy_ca install -y --no-install-recommends unzip && rm -rf /var/lib/apt/lists
COPY php/composer.json ./
RUN --mount=type=secret,id=proxy_ca,required=true COMPOSER_CAFILE=/run/secrets/proxy_ca composer install --no-dev --no-interaction --prefer-dist
COPY php/app.php ./
CMD ["sh", "-c", "php -S 0.0.0.0:$PORT app.php"]
