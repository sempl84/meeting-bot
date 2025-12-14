#!/bin/bash

# Скрипт развертывания Meeting Bot на сервере
# Использование: ./deploy.sh

set -e

echo "🚀 Начинаем развертывание Meeting Bot..."

# Проверка Docker
echo "📦 Проверка Docker..."
if ! command -v docker &> /dev/null; then
    echo "❌ Docker не установлен. Установите Docker сначала."
    exit 1
fi

if ! command -v docker compose &> /dev/null && ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose не установлен. Установите Docker Compose сначала."
    exit 1
fi

echo "✅ Docker установлен: $(docker --version)"
echo "✅ Docker Compose установлен: $(docker compose version 2>/dev/null || docker-compose version)"

# Проверка .env файла
echo ""
echo "📝 Проверка .env файла..."
if [ ! -f .env ]; then
    echo "⚠️  Файл .env не найден!"
    echo "📋 Создайте файл .env на основе ENV_SETUP.md"
    echo "   Или скопируйте пример:"
    echo "   cp ENV_SETUP.md .env"
    echo "   nano .env"
    read -p "Продолжить после создания .env? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo "✅ Файл .env найден"
fi

# Проверка обязательных переменных
echo ""
echo "🔍 Проверка обязательных переменных в .env..."
source .env 2>/dev/null || true

REQUIRED_VARS=("S3_ACCESS_KEY_ID" "S3_SECRET_ACCESS_KEY" "S3_BUCKET_NAME")
MISSING_VARS=()

for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ] || [[ "${!var}" == *"your_"* ]] || [[ "${!var}" == *"ваш_"* ]]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "⚠️  Следующие переменные не заполнены или содержат placeholder значения:"
    printf '   - %s\n' "${MISSING_VARS[@]}"
    echo "   Пожалуйста, заполните их в файле .env"
    read -p "Продолжить все равно? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Сборка образа
echo ""
echo "🔨 Сборка Docker образа..."
docker build -f Dockerfile.production -t meeting-bot:latest .

if [ $? -eq 0 ]; then
    echo "✅ Образ успешно собран"
else
    echo "❌ Ошибка при сборке образа"
    exit 1
fi

# Остановка существующих контейнеров (если есть)
echo ""
echo "🛑 Остановка существующих контейнеров (если есть)..."
docker compose -f docker-compose.production.yml down 2>/dev/null || true

# Запуск контейнеров
echo ""
echo "🚀 Запуск контейнеров..."
docker compose -f docker-compose.production.yml up -d

if [ $? -eq 0 ]; then
    echo "✅ Контейнеры запущены"
else
    echo "❌ Ошибка при запуске контейнеров"
    exit 1
fi

# Ожидание запуска
echo ""
echo "⏳ Ожидание запуска сервисов (10 секунд)..."
sleep 10

# Проверка статуса
echo ""
echo "📊 Статус контейнеров:"
docker compose -f docker-compose.production.yml ps

# Проверка health
echo ""
echo "🏥 Проверка health check..."
HEALTH_CHECK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health || echo "000")

if [ "$HEALTH_CHECK" = "200" ]; then
    echo "✅ Приложение работает! Health check: OK"
    echo ""
    echo "🌐 Доступные endpoints:"
    echo "   - Health: http://localhost:3000/health"
    echo "   - Status: http://localhost:3000/isbusy"
    echo "   - Metrics: http://localhost:3000/metrics"
else
    echo "⚠️  Health check не прошел (код: $HEALTH_CHECK)"
    echo "   Проверьте логи: docker compose -f docker-compose.production.yml logs meeting-bot"
fi

# Проверка Redis
echo ""
echo "🔴 Проверка Redis..."
REDIS_PING=$(docker compose -f docker-compose.production.yml exec -T redis redis-cli ping 2>/dev/null || echo "FAILED")

if [ "$REDIS_PING" = "PONG" ]; then
    echo "✅ Redis работает"
else
    echo "⚠️  Redis не отвечает. Проверьте логи: docker compose -f docker-compose.production.yml logs redis"
fi

echo ""
echo "✨ Развертывание завершено!"
echo ""
echo "📋 Полезные команды:"
echo "   Просмотр логов: docker compose -f docker-compose.production.yml logs -f"
echo "   Остановка: docker compose -f docker-compose.production.yml down"
echo "   Перезапуск: docker compose -f docker-compose.production.yml restart"
