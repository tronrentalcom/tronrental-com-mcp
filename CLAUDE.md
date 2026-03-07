# CLAUDE.md — TronRental MCP Server

## Проект

MCP-сервер для TronRental.com — позволяет AI-агентам (Claude Code, Cursor, Windsurf) покупать энергию TRON через API.

- **npm:** `@tronrental-com/mcp-server`
- **MCP Registry:** `io.github.tronrental-com/tronrental`
- **GitHub:** `tronrentalcom/tronrental-com-mcp`
- **Локальный путь:** `~/tronrental-mcp/`

## Структура

```
src/
├── index.ts    — MCP сервер (10 tools + instructions)
└── api.ts      — HTTP клиент TronRental REST API
server.json     — MCP Registry metadata
```

## 10 Tools

| # | Tool | Auth | Описание |
|---|------|------|----------|
| 1 | `get_prices` | Нет | Текущие цены на энергию и BW |
| 2 | `calculate_savings` | Нет | Калькулятор экономии (burn vs rental) |
| 3 | `register` | Нет | Регистрация аккаунта |
| 4 | `login` | Нет | Логин в существующий аккаунт |
| 5 | `create_api_key` | Bearer token | Создание API-ключа |
| 6 | `get_deposit_address` | API key | Депозитный адрес для пополнения |
| 7 | `get_balance` | API key | Баланс аккаунта |
| 8 | `buy_energy` | API key | Покупка энергии |
| 9 | `get_order` | API key | Статус заказа |
| 10 | `regenerate_deposit_address` | API key | Смена депозитного адреса |

## API

- **Base URL:** `https://api.tronrental.com/v1`
- **Auth:** Bearer token (JWT от register/login) или API key
- **Документация:** https://docs.tronrental.com

## Сборка и запуск

```bash
npm install
npm run build     # TypeScript → dist/
npm start         # запуск сервера (stdio)
npm run dev       # запуск через tsx (без сборки)
```

## Публикация

```bash
# 1. Обновить версию в package.json и server.json
# 2. Собрать и опубликовать на npm
npm run build && npm publish --access public

# 3. Опубликовать в MCP Registry
./mcp-publisher login github    # если токен протух
./mcp-publisher publish
```

- npm-токен в `~/.npmrc` (granular access token, bypass 2FA)
- MCP Registry auth через GitHub OAuth (`mcp-publisher login github`)
- `mcpName` в `package.json` должен совпадать с `name` в `server.json`

## Подключение к Claude Code

```bash
# Без API-ключа (агент зарегистрируется сам)
claude mcp add tronrental -- npx -y @tronrental-com/mcp-server

# С API-ключом
claude mcp add tronrental -e TRONRENTAL_API_KEY=key -- npx -y @tronrental-com/mcp-server

# Локальная разработка
claude mcp add tronrental -s user -- node ~/tronrental-mcp/dist/index.js
```

## Важно

- `instructions` в `McpServer` — главный способ управления поведением агента. Здесь объясняется как работают комиссии TRON, какой flow проходить, и что НЕ делать (не выдумывать термины)
- Каждый tool возвращает `next_step` — подсказка агенту что делать дальше
- `calculate_savings` возвращает `explanation` — готовое объяснение для пользователя
- Версии в трёх местах: `package.json`, `server.json`, `McpServer constructor` — обновлять синхронно
