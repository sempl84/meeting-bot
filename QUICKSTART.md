# Быстрый старт развертывания

## Что уже готово

✅ `docker-compose.production.yml` - конфигурация для продакшена  
✅ `deploy.sh` - скрипт автоматического развертывания  
✅ `ENV_SETUP.md` - инструкция по настройке переменных окружения  
✅ `DEPLOY_PRODUCTION.md` - подробная инструкция по развертыванию  

## Быстрый старт (3 шага)

### 1. Создайте .env файл

```bash
cd ~/meeting-bot
nano .env
```

Скопируйте содержимое из `ENV_SETUP.md` и заполните своими значениями:
- `S3_ACCESS_KEY_ID` - из Yandex Cloud
- `S3_SECRET_ACCESS_KEY` - из Yandex Cloud  
- `S3_BUCKET_NAME` - имя вашего bucket

### 2. Запустите скрипт развертывания

```bash
./deploy.sh
```

Скрипт автоматически:
- Проверит Docker
- Проверит .env файл
- Соберет Docker образ
- Запустит контейнеры
- Проверит работоспособность

### 3. Проверьте результат

```bash
curl http://localhost:3000/health
```

Должен вернуть: `{"status":"healthy",...}`

## Или вручную (без скрипта)

```bash
# 1. Создать .env (см. ENV_SETUP.md)

# 2. Собрать образ
docker build -f Dockerfile.production -t meeting-bot:latest .

# 3. Запустить
docker compose -f docker-compose.production.yml up -d

# 4. Проверить
curl http://localhost:3000/health
```

## Получение credentials для Yandex Cloud

1. [Yandex Cloud Console](https://console.cloud.yandex.ru/) → Object Storage
2. Создайте bucket (если нет)
3. Service Accounts → Create → Роль: `storage.editor`
4. Keys → Create new key → Access key
5. Сохраните Access Key ID и Secret Access Key

## Проблемы?

См. `DEPLOY_PRODUCTION.md` раздел "Устранение неполадок"
