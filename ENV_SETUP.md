# Настройка переменных окружения для продакшена

Создайте файл `.env` в корне проекта со следующим содержимым:

```bash
# Application Settings
NODE_ENV=production
PORT=3000

# Yandex Cloud Storage (S3-compatible)
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://storage.yandexcloud.net
S3_REGION=ru-central1
S3_ACCESS_KEY_ID=your_access_key_id_here
S3_SECRET_ACCESS_KEY=your_secret_access_key_here
S3_BUCKET_NAME=your_bucket_name_here
S3_USE_MINIO_COMPATIBILITY=false

# GCP variables (required by application, use same values as S3)
GCP_DEFAULT_REGION=ru-central1
GCP_MISC_BUCKET=your_bucket_name_here

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

## Как получить credentials для Yandex Cloud Storage:

1. Войдите в [Yandex Cloud Console](https://console.cloud.yandex.ru/)
2. Перейдите в раздел "Object Storage" и создайте bucket (если еще не создан)
3. Создайте Service Account:
   - Перейдите в "Service Accounts"
   - Создайте новый Service Account
   - Назначьте роль `storage.editor` или `storage.admin`
4. Создайте Static Access Key:
   - В Service Account выберите "Keys" → "Create new key"
   - Выберите "Access key"
   - Сохраните Access Key ID и Secret Access Key

## Важно:

- Замените `your_access_key_id_here`, `your_secret_access_key_here` и `your_bucket_name_here` на реальные значения
- Файл `.env` не должен попадать в git (уже добавлен в .gitignore)
- Если Redis уже установлен на сервере, измените `REDIS_HOST` на `localhost` или IP адрес сервера
