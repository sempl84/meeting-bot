# Инструкция по развертыванию Meeting Bot на сервере

## Предварительные требования

1. Docker и Docker Compose установлены на сервере
2. Репозиторий склонирован на сервере
3. Создан Service Account и Static Access Key в Yandex Cloud
4. Создан bucket в Yandex Cloud Object Storage

## Шаг 1: Проверка Docker

```bash
# Проверить версию Docker
docker --version
docker compose version

# Если Docker не установлен, установите его:
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# После этого нужно перелогиниться или выполнить: newgrp docker
```

## Шаг 2: Создание .env файла

Создайте файл `.env` в корне проекта:

```bash
cd ~/meeting-bot  # или путь где находится проект
nano .env
```

Вставьте следующее содержимое и замените значения на свои:

```bash
# Application Settings
NODE_ENV=production
PORT=3000

# Yandex Cloud Storage (S3-compatible)
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://storage.yandexcloud.net
S3_REGION=ru-central1
S3_ACCESS_KEY_ID=ваш_access_key_id
S3_SECRET_ACCESS_KEY=ваш_secret_access_key
S3_BUCKET_NAME=имя_вашего_bucket
S3_USE_MINIO_COMPATIBILITY=false

# GCP variables (required by application)
GCP_DEFAULT_REGION=ru-central1
GCP_MISC_BUCKET=имя_вашего_bucket

# Redis Configuration
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_CONSUMER_ENABLED=true
REDIS_QUEUE_NAME=jobs:meetbot:list

# Optional: Recording Settings
MAX_RECORDING_DURATION_MINUTES=180
MEETING_INACTIVITY_MINUTES=1
INACTIVITY_DETECTION_START_DELAY_MINUTES=1
```

Сохраните файл (Ctrl+O, Enter, Ctrl+X в nano).

## Шаг 3: Сборка Docker образа

```bash
# Убедитесь что вы в директории проекта
cd ~/meeting-bot

# Собрать образ
docker build -f Dockerfile.production -t meeting-bot:latest .
```

Этот процесс может занять 10-15 минут при первой сборке.

## Шаг 4: Запуск контейнеров

```bash
# Запустить контейнеры в фоновом режиме
docker compose -f docker-compose.production.yml up -d

# Проверить статус
docker compose -f docker-compose.production.yml ps

# Просмотр логов
docker compose -f docker-compose.production.yml logs -f meeting-bot
```

## Шаг 5: Проверка работоспособности

```bash
# Health check
curl http://localhost:3000/health

# Проверка статуса
curl http://localhost:3000/isbusy

# Проверка метрик
curl http://localhost:3000/metrics
```

## Шаг 6: Проверка Redis

```bash
# Проверить подключение к Redis
docker compose -f docker-compose.production.yml exec redis redis-cli ping
# Должен вернуть: PONG
```

## Полезные команды

### Остановка контейнеров
```bash
docker compose -f docker-compose.production.yml down
```

### Перезапуск контейнеров
```bash
docker compose -f docker-compose.production.yml restart
```

### Просмотр логов
```bash
# Все сервисы
docker compose -f docker-compose.production.yml logs -f

# Только meeting-bot
docker compose -f docker-compose.production.yml logs -f meeting-bot

# Только redis
docker compose -f docker-compose.production.yml logs -f redis
```

### Обновление приложения
```bash
# Остановить контейнеры
docker compose -f docker-compose.production.yml down

# Обновить код (если нужно)
git pull origin main

# Пересобрать образ
docker build -f Dockerfile.production -t meeting-bot:latest .

# Запустить заново
docker compose -f docker-compose.production.yml up -d
```

### Проверка использования ресурсов
```bash
docker stats
```

## Устранение неполадок

### Порт 3000 занят
```bash
# Проверить что использует порт
sudo lsof -i :3000

# Или изменить порт в .env и docker-compose.production.yml
```

### Проблемы с подключением к Redis
```bash
# Проверить что Redis контейнер запущен
docker compose -f docker-compose.production.yml ps redis

# Проверить логи Redis
docker compose -f docker-compose.production.yml logs redis
```

### Проблемы с Yandex Cloud Storage
- Убедитесь что Access Key ID и Secret Access Key правильные
- Проверьте что bucket существует
- Проверьте что Service Account имеет права `storage.editor` или `storage.admin`
- Проверьте что endpoint правильный: `https://storage.yandexcloud.net`

### Контейнер не запускается
```bash
# Проверить логи
docker compose -f docker-compose.production.yml logs meeting-bot

# Проверить что .env файл существует и правильно заполнен
cat .env

# Проверить что образ собран
docker images | grep meeting-bot
```

## Использование существующего Redis на сервере

Если Redis уже установлен на сервере (не в Docker), можно использовать его:

1. Удалите сервис `redis` из `docker-compose.production.yml`
2. В `.env` измените:
   ```bash
   REDIS_HOST=localhost  # или IP адрес сервера
   ```
3. В `docker-compose.production.yml` добавьте в сервис `meeting-bot`:
   ```yaml
   network_mode: "host"
   ```
   Или пробросьте порт Redis:
   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```
   И используйте `REDIS_HOST=host.docker.internal`

## Автозапуск при перезагрузке сервера

Docker Compose с `restart: unless-stopped` автоматически перезапустит контейнеры после перезагрузки сервера, если Docker настроен на автозапуск:

```bash
# Включить автозапуск Docker
sudo systemctl enable docker
sudo systemctl start docker
```
