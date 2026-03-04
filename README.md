# SnabSystem — Система управления заявками

## Обзор проекта

**SnabSystem** — полнофункциональная система управления заявками на снабжение с тремя ролями пользователей, историей изменений, прикреплением файлов и системой уведомлений.

## 🔗 URL

- **Локальная разработка**: http://localhost:3000

## 👥 Роли и доступы

| Роль | Логин | Пароль | Возможности |
|------|-------|--------|-------------|
| 🔑 Администратор | `admin` | `admin123` | Просмотр всех заявок, управление пользователями (CRUD), назначение ролей, блокировка |
| 👤 Заявитель | `applicant1` | `password123` | Создание заявок, просмотр своих заявок, прикрепление файлов |
| 🏪 Снабженец | `supplier1` | `password123` | Просмотр всех заявок, смена статусов, скачивание файлов |

## ✅ Реализованные функции

### Администратор
- ✅ Вход по логину/паролю (без регистрации)
- ✅ Просмотр всех заявок с фильтрами (статус, проект, заявитель, дата, поиск)
- ✅ Дашборд со статистикой
- ✅ Управление пользователями: добавление, редактирование, удаление
- ✅ Назначение ролей (Заявитель / Снабженец)
- ✅ Блокировка/разблокировка пользователей
- ✅ Просмотр истории изменений по каждой заявке

### Заявитель
- ✅ Вход по логину/паролю (создан администратором)
- ✅ Создание заявок (Проект, Наименование, Модель, Количество, Комментарий)
- ✅ Прикрепление файлов (PDF, DOC, DOCX, XLS, XLSX, JPG, PNG, до 20MB)
- ✅ Просмотр только своих заявок
- ✅ Просмотр статуса и причины отказа
- ✅ Просмотр истории изменений по своим заявкам
- ✅ Уведомления об изменении статуса

### Снабженец
- ✅ Просмотр всех заявок
- ✅ Уведомления о новых заявках
- ✅ Смена статуса (Исполнено / На рассмотрении / Отклонено с обязательной причиной)
- ✅ Просмотр и скачивание файлов
- ✅ Просмотр истории изменений

### История изменений (Audit Log)
- ✅ Фиксация факта создания заявки
- ✅ Все изменения статуса (кто, когда, причина)
- ✅ Добавление/удаление файлов
- ✅ Неизменяемая, сортированная по дате

### Уведомления
- ✅ Новая заявка → снабженцу и администратору
- ✅ Изменение статуса → заявителю
- ✅ Центр уведомлений в интерфейсе
- ✅ Отметка прочитанными (по одному и все сразу)

## 🗄️ Структура базы данных

| Таблица | Описание |
|---------|----------|
| `users` | Пользователи (id, username, email, password_hash, role, full_name, is_blocked) |
| `projects` | Проекты (id, name, description, is_active) |
| `requests` | Заявки (id, applicant_id, project_id, product_name, model, quantity, comment, status, rejection_reason) |
| `request_files` | Файлы к заявкам (id, request_id, uploaded_by, file_name, file_size, mime_type, file_data) |
| `request_status_history` | История изменений (id, request_id, changed_by, action, old_value, new_value, comment) |
| `notifications` | Уведомления (id, user_id, title, message, is_read, request_id) |
| `sessions` | Сессии (id, user_id, expires_at) |

## 🔌 API Endpoints

```
POST /api/auth/login            — Вход в систему
POST /api/auth/logout           — Выход
GET  /api/auth/me               — Текущий пользователь

GET  /api/projects              — Список проектов
POST /api/projects              — Создать проект (admin)

GET  /api/requests              — Список заявок (с фильтрами)
POST /api/requests              — Создать заявку (applicant)
GET  /api/requests/:id          — Заявка + файлы
PATCH /api/requests/:id/status  — Смена статуса (supplier/admin)
GET  /api/requests/stats/summary — Статистика
POST /api/requests/:id/files    — Загрузить файл
GET  /api/requests/:id/files/:fid — Скачать файл
DELETE /api/requests/:id/files/:fid — Удалить файл
GET  /api/requests/:id/history  — История изменений

GET  /api/users                 — Список пользователей (admin)
POST /api/users                 — Создать пользователя (admin)
PUT  /api/users/:id             — Редактировать (admin)
PATCH /api/users/:id/block      — Блокировка (admin)
DELETE /api/users/:id           — Удалить (admin)

GET  /api/notifications         — Уведомления
GET  /api/notifications/unread-count — Кол-во непрочитанных
PATCH /api/notifications/:id/read — Прочитать
PATCH /api/notifications/read-all — Прочитать все
```

## 🛠️ Технический стек

- **Backend**: Hono (TypeScript) + Cloudflare Workers
- **База данных**: Cloudflare D1 (SQLite)
- **Frontend**: HTML + TailwindCSS (CDN) + Vanilla JS + Axios
- **Сборка**: Vite + @hono/vite-cloudflare-pages
- **Dev-сервер**: Wrangler Pages Dev + PM2

## 🚀 Запуск разработки

```bash
cd /home/user/webapp

# Применить миграции
npx wrangler d1 migrations apply webapp-production --local

# Загрузить тестовые данные
npx wrangler d1 execute webapp-production --local --file=./seed.sql

# Собрать и запустить
npm run build
pm2 start ecosystem.config.cjs
```

## 📊 Статус

- ✅ Активен
- **Дата обновления**: 2026-03-03
