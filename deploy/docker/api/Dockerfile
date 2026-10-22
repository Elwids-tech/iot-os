FROM php:8.4.27-cli-bookworm AS vendor

RUN apt-get update \
    && apt-get install -y --no-install-recommends git libpq-dev libzip-dev unzip \
    && docker-php-ext-install pdo_pgsql pcntl opcache \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
COPY apps/api/composer.json apps/api/composer.lock ./
RUN composer install \
    --no-interaction \
    --no-progress \
    --no-scripts \
    --prefer-dist \
    --optimize-autoloader

FROM php:8.4.27-cli-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl libpq-dev poppler-utils \
    && docker-php-ext-install pdo_pgsql pcntl opcache \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /var/www/html
COPY --from=vendor /app/vendor ./vendor
COPY apps/api ./
RUN php artisan help:validate
COPY contracts /var/contracts
COPY deploy/docker/api/uploads.ini /usr/local/etc/php/conf.d/uploads.ini
COPY deploy/docker/api/development.ini /usr/local/etc/php/conf.d/development.ini

RUN mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache \
    && chmod -R ug+rw storage bootstrap/cache

EXPOSE 8000

CMD ["sh", "-lc", "php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=8000"]
