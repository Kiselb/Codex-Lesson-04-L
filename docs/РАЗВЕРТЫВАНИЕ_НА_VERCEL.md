# Развёртывание проекта «Шальные Шнурки» на Vercel

Проект подготовлен для двух режимов:

- локально используется `data/laces.sqlite` и команда `.\start.ps1`;
- на Vercel используется облачная база Turso и функция `api/[...route].js`.

Локальный SQLite-файл загружать на Vercel не нужно: файловая система функций не предназначена для постоянных записей.

## 1. Разместить код в Git-репозитории

Создайте репозиторий на GitHub, GitLab или Bitbucket и отправьте туда содержимое проекта. Не добавляйте файлы `.env`, `data/*.sqlite` и каталог `node_modules` — они уже перечислены в `.gitignore`.

## 2. Создать базу Turso

Удобнее всего установить Turso из [Vercel Marketplace](https://vercel.com/marketplace) и подключить интеграцию к будущему проекту. Альтернативный вариант — создать базу в панели [Turso](https://turso.tech/) самостоятельно.

Потребуются два значения:

- URL базы вида `libsql://...turso.io`;
- токен доступа к базе.

## 3. Создать проект Vercel

1. Откройте [Vercel Dashboard](https://vercel.com/new).
2. Импортируйте Git-репозиторий.
3. В качестве **Framework Preset** выберите **Other**.
4. Корневой каталог оставьте корнем репозитория.
5. Build Command оставьте пустой.
6. Output Directory — `public`.

Параметры Build Command и Output Directory уже закреплены в `vercel.json`.

## 4. Добавить переменные окружения

В разделе **Project → Settings → Environment Variables** добавьте:

| Переменная | Значение |
|---|---|
| `TURSO_DATABASE_URL` | URL базы Turso |
| `TURSO_AUTH_TOKEN` | токен базы Turso |
| `AUTH_SECRET` | длинная случайная строка для подписи авторизации |
| `ADMIN_USERNAME` | логин администратора, например `admin` |
| `ADMIN_PASSWORD` | сложный первоначальный пароль администратора |
| `SEED_DEMO_USERS` | `true` для учебной демонстрации или `false` для реального сайта |
| `PROXY_API_API_KEY` | ключ доступа к OpenAI-совместимому прокси |
| `PROXY_API_OPENAI_BASE_URL` | базовый URL прокси, обычно оканчивается на `/v1` |
| `PROXY_API_OPENAI_MODEL` | модель, например `openai/gpt-4.1-mini` |

Безопасный `AUTH_SECRET` можно получить в PowerShell:

```powershell
[Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48))
```

Добавьте переменные как минимум для окружений **Production** и **Preview**. Для Preview желательно использовать отдельную тестовую базу Turso.

## 5. Решить, нужны ли демонстрационные клиенты

Если указать `SEED_DEMO_USERS=true`, при первом запросе будут созданы:

- `lace_anna` / `client123`;
- `lace_ivan` / `client123`.

Для публичного рабочего сайта установите `false`. Демонстрационные пароли предназначены только для учебной проверки.

Администратор создаётся только при наличии `ADMIN_PASSWORD`. После создания изменение переменной не меняет пароль существующей записи автоматически.

## 6. При необходимости перенести локальные данные

Если нужно перенести текущих пользователей, факты, диалоги и сообщения из `data/laces.sqlite`, задайте переменные в локальном PowerShell:

```powershell
$env:TURSO_DATABASE_URL = 'libsql://...turso.io'
$env:TURSO_AUTH_TOKEN = 'ваш-токен'
.\migrate-turso.ps1
```

Скрипт можно запускать повторно: записи с существующими идентификаторами не дублируются. Перед переносом рекомендуется создать резервную копию локального SQLite-файла.

## 7. Выполнить Deploy

Нажмите **Deploy**. Vercel выполнит `pnpm install`, опубликует содержимое `public` и развернёт API из `api/[...route].js`.

При первом обращении к API функция:

1. создаст таблицы по `database/schema.sql`;
2. создаст администратора, если задан `ADMIN_PASSWORD`;
3. при необходимости создаст демонстрационных клиентов.

## 8. Проверить результат

1. Откройте адрес Deployment.
2. Войдите администратором.
3. Зарегистрируйте тестового клиента.
4. Сообщите агенту имя, цвет и бюджет.
5. Начните новый диалог и проверьте, что сведения сохранились.
6. Убедитесь, что под ответом отображается пометка **Ответ OpenAI**. Пометка **Резервный ответ** означает, что запрос к прокси завершился ошибкой или переменные LLM не заданы.
7. Откройте панель администратора и убедитесь, что клиент отображается.
8. Проверьте логи в **Vercel → Project → Observability → Functions**.

## 9. Важные замечания

- Смена `AUTH_SECRET` завершит все существующие пользовательские сессии.
- `TURSO_AUTH_TOKEN` и `ADMIN_PASSWORD` нельзя добавлять в Git.
- `PROXY_API_API_KEY` также нельзя добавлять в Git или клиентский JavaScript: он используется только внутри серверной функции.
- Для Production и Preview лучше использовать разные базы и токены.
- Локальная команда `.\start.ps1` продолжает работать без Turso.
- Файл `knowledge/company.txt` принудительно включён в серверную функцию через `includeFiles` в `vercel.json`.

Официальные материалы: [Vercel Functions](https://vercel.com/docs/functions), [настройка сборки](https://vercel.com/docs/builds/configure-a-build), [Vercel Marketplace Storage](https://vercel.com/docs/marketplace-storage), [Turso JavaScript SDK](https://docs.turso.tech/sdk/ts/quickstart).
