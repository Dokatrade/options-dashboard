**Options-Dashboard — Полная архитектура и руководство по воссозданию**

Цель: описать систему максимально подробно: стек, протоколы, источники данных, потоки, расчеты, хранилище и UI. По этому документу можно собрать аналогичный дашборд с нуля.

**1) Общее назначение**
- Локальное SPA-приложение для работы с опционными позициями (ETH, Bybit Public API): учет/просмотр, расчеты PnL и греков, построение payoff-графиков, отслеживание ликвидности, правила “IF…THEN…”, импорт/экспорт.
- Реалтайм цен берется из WebSocket Bybit v5, снапшоты и справочные данные — из REST v5. Для якоря “Index” (спот-цены базового актива) используется линейный тикер `ETHUSDT` (Bybit Linear) — именно поле `indexPrice`.

**2) Технологический стек**
- Клиент: React 18 + TypeScript, Vite.
- Состояние: Zustand с персистом в `localStorage`.
- График рынка: TradingView Advanced Chart (встраиваемый виджет, загрузка `https://s3.tradingview.com/tv.js`).
- Источники данных: Bybit Public API v5 (REST и WebSocket).

**3) Символы и нормализация**
- Опционы Bybit: `ETH-<DDMMMYY>-<STRIKE>-<C|P>-USDT`, пример: `ETH-27SEP24-2700-C-USDT`.
- Перп/спот: `ETHUSDT`.
- Нормализация для USDT-сеттла: `ensureUsdtSymbol(raw)` приводит `...-USDC` к `...-USDT` и дополняет суффикс там, где он отсутствует (см. `src/utils/symbols.ts`).
- Получение базового спот-тикера по любому символу: `inferUnderlyingSpotSymbol(symbol)` → обычно `ETHUSDT` (см. `src/utils/underlying.ts`).

**4) Сетевое взаимодействие и протоколы**
- REST (базовый URL): в дев-режиме `API = /bybit` (проксируется Vite на `https://api.bybit.com`), в проде `API = https://api.bybit.com` (см. `src/services/bybit.ts`, `vite.config.ts`).
  - Инструменты (опционы): `GET /v5/market/instruments-info?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT` с пагинацией через `cursor`.
  - Тикеры опционов: `GET /v5/market/tickers?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`.
  - Снэпшот спота (используется в некоторых местах вне модального View): `GET /v5/market/tickers?category=spot&symbol=ETHUSDT`.
  - Историческая волатильность (HV30): `GET /v5/market/historical-volatility?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT&period=30`.
  - L1 книга (фоллбэк для котировок): `GET /v5/market/orderbook?category=option&symbol=<SYMBOL>&limit=1`.
  - Цена экспирации (settlement):
    - Прямо: `GET /v5/market/delivery-price?category=option&symbol=<SYMBOL>[&settleCoin=USDT]`.
    - История: `GET /v5/market/delivery-history?category=option&baseCoin=ETH[&settleCoin=USDT]`.

- WebSocket (Bybit Public WS v5):
  - Опционы: `wss://stream.bybit.com/v5/public/option`.
  - Спот: `wss://stream.bybit.com/v5/public/spot`.
  - Линейные контракты: `wss://stream.bybit.com/v5/public/linear` (используется, чтобы читать `indexPrice` для `ETHUSDT` и задавать единый “Index” (perp anchor) во всех окнах View).
  - Формат подписки на открытие: отправляется JSON `{"op":"subscribe","args":["tickers.<SYMBOL>","orderbook.1.<SYMBOL>"]}` на соответствующее подключение. Один WS-сокет ведет собственный список символов; при реконнекте выполняется пере‑подписка.
  - Пинг: каждые ~15 секунд отправляется `{"op":"ping"}`.
  - Сообщения:
    - Тикеры приходят в топике `tickers.<SYMBOL>` с телом в `data` или в `result.list` (обрабатывается оба варианта; поддержка массив/один объект).
    - Поля, которые извлекаются в тип `Ticker` (см. `src/utils/types.ts`):
      - `bid1Price`, `ask1Price` (фоллбэки: `bestBidPrice`/`bestAskPrice`/`bidPrice`/`askPrice`).
      - `markPrice`, `lastPrice`, `price24hPcnt`.
      - `markIv`: если значение по модулю ≤ 3 — трактуется как доля и масштабируется ×100 (иначе — уже проценты).
      - `indexPrice`: для опционов — берем `underlyingPrice` (или `indexPrice`, если первого нет); для линейного `ETHUSDT` — `indexPrice` как есть.
      - Греки: `delta`, `gamma`, `vega`, `theta`; а также `openInterest`.
    - L1 книга приходит в топике `orderbook.1.<SYMBOL>` (поле `a`/`b`, поддерживаются оба формата — массивы `[price, size]` и объекты `{ price, size }`). Из них формируется `obBid`/`obAsk`.
  - Реконнект и бэкофф: прогрессивная задержка до 15 сек; при каждом закрытии — автоподключение и пере‑подписка.

**5) Внутренние типы и утилиты**
- Типы: `src/utils/types.ts` — `InstrumentInfo`, `Ticker`, `Leg`, `PositionLeg`, `SpreadPosition`, `Position`, `CloseSnapshot` и пр.
- Котировочные утилиты: `src/services/bybit.ts` — `bestBidAsk(t)`, `midPrice(t)` (предпочитает L1, затем mark). HV30 парсится и нормализуется (если величины ≤ 5 — предполагается доля и масштабируется ×100).
- Black–Scholes: `src/utils/bs.ts` — `bsPrice`, `bsImpliedVol` (биссекция + защиты по границам), `normCdf`.

**6) Состояние приложения (Zustand, `src/store/store.ts`)**
- Модели:
  - `SpreadPosition` (вертикаль): две ноги, `cEnter`, опционально `entryShort/entryLong`, `qty`, `settlements` по экспирациям.
  - `Position` (произвольная комбинация): массив `legs` (`PositionLeg` с полями side/qty/entryPrice/createdAt), `settlements`, `closeSnapshot`.
  - `PortfolioSettings`: пока `depositUsd`.
- Операции: добавление/удаление/обновление; закрытие; установка settlement-цен; импорт состояния из JSON (с нормализацией символов и снимков закрытия), экспорт из топ-бара.
- Персист: `persist(..., { name: 'options-dashboard', version: 4, migrate })` — миграции приводят старые записи к текущему формату, в т.ч. нормализация символов и выравнивание `createdAt` по самым ранним ногам.
- UI-персист (в `localStorage`):
  - Позиции/таблица: `positions-ui-v1`, `positions-columns-v1`, `positions-actions-v1`, шаблоны/правила IF: `if-templates-v1`/`if-rules-v3`.
  - Модал View (пер-позиции и глобально): `position-view-ui-v1`, `position-view-ui-bypos-v1`.
  - Черновик добавления позиций: `options-draft-v1`.
  - Виджет рынка: `market-chart-interval`, `market-chart-visible-range`.

**7) Основные экраны и логика**
- MarketContextCard (`src/components/MarketContextCard.tsx`)
  - Встраивает TradingView по символу `BYBIT:ETHUSDT`. Поддерживает смену темы, сохранение интервала (15m/1h/4h/1d) и видимого диапазона.

- UnifiedPositionsTable (`src/components/UnifiedPositionsTable.tsx`)
  - Склеивает `spreads` и `positions` в единую таблицу. Метрики на строку: `netEntry`, `netMid`, `PnL`, `delta/gamma/vega/theta`, показатели ликвидности (макс. спред, мин. OI, макс. спред %), DTE, ширина вертикали, maxLoss и пр.
  - Режимы обновления:
    - Realtime (по умолчанию, когда SlowMode выключен): подписка через WS на `tickers.<SYMBOL>` и `orderbook.1.<SYMBOL>` для всех ног; ETHUSDT также подписывается по линейным перпам для IF‑правил. Дозировано ограничивается числом символов (`slice(...)`) во избежание перегрузки.
    - SlowMode (`src/contexts/SlowModeContext.tsx`): периодические REST‑обновления (`fetchOptionTickers`, `fetchPerpEth`, дополнительно `fetchOrderbookL1` чанками). Также есть быстрый `captureRealtimeSnapshot` (короткая подписка WS на 500 мс для освежения полей и тут же отписка).
  - Определение базовой цены (perp/index) для строки (для IF и некоторых вычислений):
    - Приоритет: ETHUSDT (перп) из WS (mark/last) → любой `indexPrice` ноги → `settlements` (если закрыто/экспирировано).
  - Авто‑settlement: периодический опрос `delivery-price`/`delivery-history`, отметка settled по экспирациям; автозакрытие позиции, когда все опционные ноги просрочены.
  - Экспорт CSV; IF‑правила: простая DSL с параметрами на уровне позиции/ноги и композицией условий (AND/OR).

- AddPosition (`src/components/AddPosition.tsx` + подпапка `add-position/`)
  - Загрузка списка инструментов (опционы ETH USDT), фильтрация по дате/типу (C/P), сбор опциона-чейна из REST и дополнение символами, встреченными в лайв‑тикерах.
  - Живые котировки через WS; REST‑фоллбэк L1 (пулинг). Фильтры по Δ‑диапазону, OI, максимальному спреду, опция “Show all strikes”.
  - Черновик ног: добавление опционов и/perp (`ETHUSDT`), расчет суммарного кредита/дебета, автопересчет количества перп‑контрактов по нотио‑налу и наоборот.
  - Сохранение: если 2 ноги образуют вертикаль (same type/expiry, противоположные стороны, равный qty) — сохраняется как `SpreadPosition` с `cEnter` и per‑leg entry; иначе — как `Position` с пер‑ноговыми entryPrice = текущим mid.

- PositionView (`src/components/PositionView.tsx`)
  - Подписки:
    - На все ноги позиции: опцион/перп WS для котировок и L1.
    - На линейный тикер базового актива: через `subscribeLinearTicker` на `wss://stream.bybit.com/v5/public/linear` по символу, полученному из `inferUnderlyingSpotSymbol(...)` (обычно `ETHUSDT`). Хранится карта `linearIndex[symbol]`.
  - Якорь Index (единый для всех окон View):
    - Приоритет №1: `data.indexPrice` из линейного WS‑тикера `tickers.<ETH>USDT`.
    - Фоллбэк: `indexPrice` из любой ноги (для опционов это `underlyingPrice`, подмешиваемый в тикер).
    - Крайние фоллбэки: для перп‑ног — `markPrice`/`lastPrice`/mid/bid/ask; затем среднее по входным ценам перп‑ног; затем среднее по страйкам.
    - Это значение отображается в подписи “Index: …” и задаёт x‑координату зелёной вертикальной линии на графике.
  - Расчеты по ногам:
    - `bestBidAsk` из L1/тикера, `midPrice` (если спред невалидный — берется markPrice). Исполняемая цена `exec` зависит от стороны (покупка ~ ask, продажа ~ bid; фоллбэк mid).
    - PnL: на mid и “exec” отдельно. Аггрегирование греков по знаку (long/short) с весом qty.
    - DTE‑лейбл: для множества экспираций показывается диапазон `min–max` дней.
  - Модель цены:
    - Для опционов — Black–Scholes c параметрами: `S` (perp/index), `K`, `T`, `sigma` из mark IV (или HV30 как фоллбэк, нормализованный), `r` (регулируется UI как `rPct`). Ползунок времени двигает долю оставшегося T.
    - Для PERP‑“ног” — цена равна `S`.
  - График и UX:
    - Блокируется перецентрирование: при первой инициализации фиксируется базовый x‑диапазон ±50% от `S`.
    - Нулевая DTE (день экспирации) — ползунок времени защелкивается в конец.
    - Пер‑позиционные настройки (зум, время, iv‑сдвиг, r%, видимые слои) сохраняются в `localStorage`.

**8) Ограничения подписок, устойчивость и слияние обновлений**
- Во избежание чрезмерной нагрузки подписки ограничиваются `slice(...)` (типичные лимиты: до ~1000 символов в таблице, ~400 в AddPosition, ~300 в View; линейный индекс — до 50 символов базовых, фактически 1 — `ETHUSDT`).
- После реконнекта выполняется автоматическая пере‑подписка текущих символов.
- Keepalive‑пинг каждые ~15 с. Бэкофф‑стратегия до 15 сек между попытками соединения.
- Обновления тикеров мерджатся “мягко”: в сторе per‑символьные объекты дозаполняются только валидными числовыми полями, NaN игнорируются.

**9) Сборка и запуск**
- Требования: Node.js 18+.
- Установка: `npm ci` (или `npm install`).
- Дев‑сервер: `npm run dev` (Vite, порт по умолчанию `5173`). В деве REST‑вызовы идут через прокси `/bybit` (см. `vite.config.ts`).
- Продакшн‑сборка: `npm run build` (TypeScript build + Vite build). Локальный предпросмотр: `npm run preview`.

**10) Воссоздание системы с нуля — пошаговый план**
- Инициализируйте Vite React + TS проект; подключите Zustand.
- Добавьте типы домена (`src/utils/types.ts`).
- Реализуйте утилиты BS (`src/utils/bs.ts`).
- Реализуйте REST‑клиент (`src/services/bybit.ts`):
  - Инструменты, тикеры опционов, HV30, L1 книга, спот‑снапшот, delivery‑price и delivery‑history; обратите внимание на нормализацию `markIv`/HV.
- Реализуйте WS‑клиент (`src/services/ws.ts`):
  - Карта подключений по URL (option/spot/linear), единая функция `subscribe(url, symbol, cb)` с подпиской на `tickers.<SYMBOL>` и `orderbook.1.<SYMBOL>`, пинг, реконнект.
  - Преобразование входных сообщений к типу `Ticker` (в т.ч. `indexPrice` = `underlyingPrice` для опционов, а для линейных — `indexPrice`).
- Символьные утилиты (`src/utils/symbols.ts`, `src/utils/underlying.ts`).
- Хранилище (`src/store/store.ts`) с персистом и миграцией.
- Экран портфеля (`src/components/UnifiedPositionsTable.tsx`):
  - Подписки на WS (или REST‑пулинг в SlowMode); расчеты метрик; IF‑правила; CSV экспорт; авто‑settlement.
- Экран добавления (`src/components/AddPosition.tsx` + подпапка):
  - Загрузка чейна, фильтры, лайв‑котировки, черновик и сохранение.
- Модальное View (`src/components/PositionView.tsx`):
  - Подписки на ноги + линейный `ETHUSDT`; порядок выбора `calc.spot`: linear `indexPrice` → legs `indexPrice` → перп/страйки/entry;
  - Расчеты BS/греков, построение payoff, зелёная линия по `S` и подпись “Index: …”.
- Контекст медленного режима (`src/contexts/SlowModeContext.tsx`).
- Виджет рынка (`src/components/MarketContextCard.tsx`).
- Кнопки бэкапа (`src/components/TopBarBackupButtons.tsx`).

**11) Решение по источнику “Index” (perp/index anchor)**
- Корректный якорь для опционов — индекс базового актива. В текущей реализации:
  - Реалтайм‑источник: линейный WS `tickers.ETHUSDT` на `wss://stream.bybit.com/v5/public/linear`, поле `data.indexPrice` — используется повсеместно в окне View (подпись и линия).
  - Фоллбэки: `underlyingPrice` из опционного тикера (WS option), далее — перп/мид и резервные эвристики.
  - Не использовать `lastPrice/markPrice` линейного перпа как якорь (смещение из‑за фондирования).

**12) Обработка ошибок и ограничения API**
- Все сетевые вызовы обернуты в try/catch, локальные фоллбэки молчат (UI устойчив к пробелам в данных).
- Ограничения на число подписок и частоту REST‑пулинга встроены; разнесение на чанки при L1‑фоллбэках.
- При отсутствии данных — метрики и значения помечаются дефисами или остаются неопределенными; вычисления (например, IV) выполняются только при валидных входных параметрах.

**13) Расширения и адаптация**
- Легко обобщить на другие базовые активы: адаптировать `inferUnderlyingSpotSymbol` и параметры REST‑вызовов (`baseCoin`/`symbol`).
- Добавить централизованный кэш “indexPrice” для переиспользования между компонентами (в репозитории есть заготовка `src/store/indexPriceCache.ts`).
- Ввести офлайн‑данные/историю по сделкам — сохранить модель, добавить журнал сделок и агрегированную аналитику.

**Файлы и роли (ключевые)**
- `src/services/ws.ts` — единый менеджер WS‑подписок (option/spot/linear), нормализация тикеров и L1.
- `src/services/bybit.ts` — REST‑клиент и расчетные утилиты котировок.
- `src/utils/{types,bs,symbols,underlying}.ts` — типы и фундаментальные утилиты.
- `src/store/store.ts` — доменное состояние с персистом.
- `src/components/UnifiedPositionsTable.tsx` — портфель, IF‑правила, авто‑settlement, CSV.
- `src/components/AddPosition.tsx` и `src/components/add-position/*` — добавление позиций с лайв‑чейном.
- `src/components/PositionView.tsx` — модальное окно расчётов/графиков, “Index” от линейного WS (ETHUSDT perp).
- `src/components/MarketContextCard.tsx` — рынок ETHUSDT (TradingView), `BYBIT:ETHUSDT`.
- `vite.config.ts` — dev‑прокси `/bybit → https://api.bybit.com`.

**Приложение A — Примеры сообщений WS и ответов REST**

- Подписка (любая категория WS):
  `{ "op": "subscribe", "args": ["tickers.ETH-27SEP24-2700-C-USDT", "orderbook.1.ETH-27SEP24-2700-C-USDT"] }`

- Ответ тикера (options, topic `tickers.ETH-27SEP24-2700-C-USDT`):
  `{
    "topic":"tickers.ETH-27SEP24-2700-C-USDT",
    "type":"snapshot",
    "ts":1727600000000,
    "data":{
      "symbol":"ETH-27SEP24-2700-C-USDT",
      "bid1Price":"12.5","ask1Price":"13.0",
      "markPrice":"12.8","lastPrice":"12.7",
      "underlyingPrice":"2705.1", "indexPrice":"2704.9",
      "markIv":"0.66", "delta":"0.35", "gamma":"0.012",
      "vega":"0.85", "theta":"-0.12", "openInterest":"1234"
    }
  }`
  Примечания: `markIv` может приходить как доля (≤ 3 по модулю) — масштабируем ×100.

- Ответ тикера (linear, topic `tickers.ETHUSDT`):
  `{
    "topic":"tickers.ETHUSDT",
    "type":"snapshot",
    "ts":1727600005000,
    "data":{
      "symbol":"ETHUSDT",
      "bid1Price":"2704.8","ask1Price":"2705.2",
      "markPrice":"2705.0","lastPrice":"2705.1",
      "indexPrice":"2705.0",
      "price24hPcnt":"0.0123"
    }
  }`

- Ответ книги L1 (topic `orderbook.1.ETH-27SEP24-2700-C-USDT`):
  `{
    "topic":"orderbook.1.ETH-27SEP24-2700-C-USDT",
    "type":"delta",
    "ts":1727600007000,
    "data":{
      "a":[["13.0","5"],["13.5","2"]],
      "b":[["12.5","4"],["12.0","3"]]
    }
  }`
  Возможен альтернативный формат с объектами: `"a":[{"price":"13.0","size":"5"}], "b":[{"price":"12.5","size":"4"}]`.

- REST — опционные тикеры:
  `GET /v5/market/tickers?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT`
  Ответ (фрагмент):
  `{
    "retCode":0,
    "result":{ "list":[
      {"symbol":"ETH-27SEP24-2700-C-USDT","bid1Price":"12.5","ask1Price":"13.0","markPrice":"12.8","underlyingPrice":"2705.1","markIv":"0.66","delta":"0.35","openInterest":"1234"}
    ]}
  }`

- REST — L1 книга:
  `GET /v5/market/orderbook?category=option&symbol=ETH-27SEP24-2700-C-USDT&limit=1`
  Ответ (фрагмент): `{"retCode":0, "result": {"a":[["13.0","5"]], "b":[["12.5","4"]]}}`.

- REST — HV30:
  `GET /v5/market/historical-volatility?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT&period=30`
  Ответ: `{"retCode":0, "result": {"list": [["1727500000000","0.62"], ["1727586400000","0.64"]] }}`.

- REST — инструменты опционов:
  `GET /v5/market/instruments-info?category=option&baseCoin=ETH&settleCoin=USDT&quoteCoin=USDT&limit=1000`
  Ответ (фрагмент): `{"retCode":0, "result": {"list": [{"symbol":"ETH-27SEP24-2700-C-USDT","deliveryTime":"1727395200000","status":"Trading"}]}}`.

**Приложение B — Схемы данных (TypeScript) и экспорты**

- Доменные типы (упрощенно):
  ```ts
  export interface Leg { symbol: string; strike: number; optionType: 'C'|'P'; expiryMs: number; }
  export interface PositionLeg { leg: Leg; side: 'short'|'long'; qty: number; entryPrice: number; createdAt?: number; hidden?: boolean; }
  export type SettlementMap = Record<string /*expiryMs*/, { settleUnderlying: number; settledAt: number }>;
  export type CloseSnapshot = { timestamp: number; indexPrice?: number; spotPrice?: number; pnlExec?: number };
  export interface SpreadPosition { id: string; short: Leg; long: Leg; cEnter: number; entryShort?: number; entryLong?: number; qty: number; note?: string; createdAt: number; closedAt?: number; closeSnapshot?: CloseSnapshot; favorite?: boolean; settlements?: SettlementMap; }
  export interface Position { id: string; createdAt: number; closedAt?: number; closeSnapshot?: CloseSnapshot; note?: string; legs: PositionLeg[]; favorite?: boolean; settlements?: SettlementMap; }
  export interface Ticker { symbol: string; bid1Price?: number; ask1Price?: number; obBid?: number; obAsk?: number; markPrice?: number; lastPrice?: number; price24hPcnt?: number; markIv?: number; indexPrice?: number; delta?: number; gamma?: number; vega?: number; theta?: number; openInterest?: number; }
  ```

- Формат Export JSON (Top bar → Export JSON):
  ```json
  {
    "version": 4,
    "exportedAt": "2025-09-30T12:34:56.000Z",
    "positions": [ { "id":"P:...", "createdAt": 1727600000000, "legs": [ /* PositionLeg */ ], "note":"...", "favorite":true, "settlements": {"1727395200000": {"settleUnderlying": 2710.12, "settledAt":1727481600000} }, "closeSnapshot": {"timestamp":1727600100000, "indexPrice":2705.0, "spotPrice":2705.0, "pnlExec": 123.45} } ],
    "spreads": [ { "id":"S:...","createdAt":1727600000000, "short":{/* Leg */}, "long":{/* Leg */}, "cEnter": 3.25, "qty":1, "note":"..." } ],
    "settings": { "depositUsd": 5000 },
    "ui": { /* снимки UI из localStorage, опционально */ }
  }
  ```

**Приложение C — Схемы UI-таблиц и вычисляемые поля**

- UnifiedPositionsTable — колонки и источники:
  - Type: эвристический ярлык стратегии (для вертикалей и т.п.).
  - Legs: компактное описание ног (направление, тип, страйк, qty, символ).
  - Expiry / DTE: ближайшая дата экспирации и число дней до нее (для множества — диапазон min–max).
  - Net entry: Σ(sign · entryPrice · qty) по всем ногам.
  - Net mid: Σ(sign · mid · qty) — mid с приоритетом L1 (best bid/ask), затем markPrice.
  - PnL ($): Net entry − Net mid; для Exec PnL — аналогично с `exec` (bid/ask в зависимости от стороны).
  - Delta/Gamma/Vega/Theta: агрегированные греческие (long = +, short = −), с весом qty.
  - Liquidity: maxSpread (максимальный спред среди ног), minOI (минимальный OI), maxSpreadPct (макс. спред в % от mid).
  - Данные поступают из локально поддерживаемой карты тикеров (мердж WS/REST), фоллбэки L1 через REST.

- PositionView — ключевые расчетные величины:
  - Spot anchor (Index): приоритет `indexPrice` из linear WS (`ETHUSDT`), далее из ног, далее эвристики.
  - Price now: моделируемая цена пер ноги: PERP = S; Option = Black–Scholes(S, K, T, σ, r).
  - Параметры модели: σ — из markIv (или HV30), r — из UI; оставшаяся T уменьшается ползунком времени.
  - Payoff: рисуется сетка S по X и PnL по Y, зелёная вертикаль по текущему S, подпись “Index: …”.

**Приложение D — IF‑правила (формат и пример)**

- Хранение: `localStorage['if-rules-v3']` как словарь `{ [rowId]: IfRule }`.
- Упрощенный формат IfRule:
  ```json
  {
    "chains": [
      { "conj": "AND", "items": [
        { "scope": "position", "cond": { "left": "pnl", "cmp": ">", "right": { "kind": "const", "value": 50 } } },
        { "scope": "leg", "legSymbol": "ETH-27SEP24-2700-C-USDT", "cond": { "left": "ivPct", "cmp": "<", "right": { "kind": "const", "value": 80 } } }
      ] }
    ]
  }
  ```
  Поддерживаются scope: `position`/`leg`, конъюнкции OR/AND, операнды — метрики таблицы/ног или константы.

**Приложение E — Потоки данных (словесная схема)**

- Инициализация:
  - Загрузка инструментов (REST) → построение чейна.
  - Включен SlowMode: периодический REST‑обновление тикеров/книг; иначе — WS‑подписки.
- Режим realtime:
  - WS option/spot: `tickers.<SYMBOL>` + `orderbook.1.<SYMBOL>` → мердж в стор локальных тикеров.
  - WS linear: `tickers.ETHUSDT` → `indexPrice` в `PositionView` (единый якорь Index).
- Расчёты:
  - Таблица: для каждой строки вычисляются mid/exec/грек/поля ликвидности.
  - View: агрегаты по ногам + BS/IV; график payoff.
- Фоллбэки:
  - L1 REST при отсутствии L1 в WS/редких символах.
  - HV30 при отсутствии `markIv`.
  - Settlement при истекших датах (и авто‑закрытие, когда все опционные ноги истекли).

**Приложение F — Пошаговые сценарии PnL/Exec и экспирации (с конкретными символами)**

- Вертикальный колл‑кредит (пример):
  - Ноги и вход:
    - Short: `ETH-27SEP24-2800-C-USDT`, qty = 1, entryShort = 12.10.
    - Long:  `ETH-27SEP24-3000-C-USDT`, qty = 1, entryLong  = 7.50.
    - Net entry (cEnter на позицию) = entryShort − entryLong = 12.10 − 7.50 = 4.60 (кредит).
  - Текущие котировки (WS + L1):
    - Short 2800C: obBid = 11.90, obAsk = 12.10 → mid = (11.90 + 12.10)/2 = 12.00.
    - Long  3000C: obBid = 7.80,  obAsk = 8.00  → mid = (7.80 + 8.00)/2 = 7.90.
  - Расчет таблицы (UnifiedPositionsTable):
    - Net mid = (+12.00) + (−7.90) = 4.10.
    - PnL (mid) = Net entry − Net mid = 4.60 − 4.10 = +0.50.
    - Exec цены ног для мгновенного закрытия: short → ask (12.10), long → bid (7.80).
    - Net exec = (+12.10) + (−7.80) = 4.30 → PnL (exec) = 4.60 − 4.30 = +0.30.
  - Экспирация (payoff):
    - При S = 2900: intrinsic(short 2800C) = 100, intrinsic(long 3000C) = 0.
      - Профиль на экспирации = Net entry − [ +100 + (−0) ] = 4.60 − 100 = −95.40.
    - При S ≥ 3000: разница страйков = 200 → максимум убытка = 200 − 4.60 = 195.40 (PnL = −195.40).

- Пример Iron Condor (4 ноги, схематично):
  - Short 2800C @ 12.10, Long 3000C @ 7.50, Short 2400P @ 9.20, Long 2200P @ 5.10, все qty = 1.
  - Net entry = (+12.10 − 7.50) + (+9.20 − 5.10) = 8.70 (кредит).
  - Для текущих котировок вычислите mid каждой ноги (приоритет L1), сложите со знаками: Net mid = Σ(sign · mid · qty).
  - PnL (mid) = Net entry − Net mid; Exec рассчитывается аналогично с bid/ask (short → ask, long → bid).
  - На экспирации профиль = Net entry − Σ(sign · intrinsic · qty), где для коллов intrinsic = max(0, S − K), для путов = max(0, K − S).

- Пример PERP ноги:
  - Leg PERP: `ETHUSDT`, qty = 0.5, side = long, entryPrice = 2700.
  - Текущее S = Index (из linear `indexPrice`) = 2715.
  - mid PERP трактуется как S; leg PnL (mid) = (S − entry) · qty = (2715 − 2700) · 0.5 = +7.5.

Примечание: во View PERP‑нога в модели ценообразования имеет цену = S, а опционная нога — `bsPrice`(S, K, T, σ, r). В таблице mid/exec по опционам берутся из котировок, а не из BS‑модели.

**Приложение G — IF‑правила: детальная спецификация и примеры**

- Синтаксис (JSON):
  - `IfRule` = `{ "chains": Array<{ "conj"?: 'AND'|'OR', "chain": IfChain }> }`.
  - `IfChain` = `{ "scope": 'position'|'leg', "legSymbol"?: string, "conds": Array<{ "conj"?: 'AND'|'OR', "cond": IfCond }> }`.
  - `IfCond` = `{ "left": IfSide, "cmp": '>'|'<'|'='|'>='|'<=' , "right": IfSide }`.
  - `IfSide` = `{ "base": IfOperand, "op"?: { "operator": '+'|'-'|'*'|'/', "operand": IfOperand } }` (одно бинарное действие опционально).
  - `IfOperand` ∈
    - `{ kind: 'number', value: number }`
    - `{ kind: 'position', metric: PosMetric }`
    - `{ kind: 'leg', metric: LegMetric, legMode: 'current'|'symbol', symbol?: string }`
  - Позиционные метрики (`PosMetric`): `spot | netEntry | netMid | kmid | pnl | pnlPctMax | delta | vega | theta | dte`.
  - Метрики ноги (`LegMetric`): `spot | bid | ask | mid | entry | pnlLeg | ivPct | vega | delta | theta | oi | dSigma`.

- Пример 1 (позиция): «Зафиксировать/сигнал если PnL ≥ 50% от максимальной прибыли И DTE ≤ 7»:
  ```json
  {
    "chains": [
      {
        "chain": {
          "scope": "position",
          "conds": [
            { "cond": { "left": { "base": { "kind":"position","metric":"pnlPctMax" } }, "cmp": ">=", "right": { "base": { "kind":"number","value":50 } } } },
            { "conj": "AND", "cond": { "left": { "base": { "kind":"position","metric":"dte" } }, "cmp": "<=", "right": { "base": { "kind":"number","value":7 } } } }
          ]
        }
      }
    ]
  }
  ```

- Пример 2 (нога по символу): «Если IV% данной ноги ≥ 80 и её mid ≥ entry × 1.3»:
  ```json
  {
    "chains": [
      {
        "chain": {
          "scope": "leg",
          "legSymbol": "ETH-27SEP24-2700-C-USDT",
          "conds": [
            { "cond": { "left": { "base": { "kind":"leg","metric":"ivPct","legMode":"symbol","symbol":"ETH-27SEP24-2700-C-USDT" } }, "cmp": ">=", "right": { "base": { "kind":"number","value":80 } } } },
            { "conj": "AND", "cond": {
              "left": { "base": { "kind":"leg","metric":"mid","legMode":"symbol","symbol":"ETH-27SEP24-2700-C-USDT" } },
              "cmp": ">=",
              "right": { "base": { "kind":"leg","metric":"entry","legMode":"symbol","symbol":"ETH-27SEP24-2700-C-USDT" }, "op": { "operator": "*", "operand": { "kind":"number","value":1.3 } } }
            } }
          ]
        }
      }
    ]
  }
  ```

- Пример 3 (смешанные величины): «Spot ≥ strike выбранной ноги + 25»:
  ```json
  {
    "chains": [
      {
        "chain": {
          "scope": "leg",
          "legSymbol": "ETH-27SEP24-2700-C-USDT",
          "conds": [
            {
              "cond": {
                "left": { "base": { "kind":"position","metric":"spot" } },
                "cmp": ">=",
                "right": {
                  "base": { "kind":"leg","metric":"mid","legMode":"symbol","symbol":"ETH-27SEP24-2700-C-USDT" },
                  "op": { "operator": "+", "operand": { "kind":"number","value":25 } }
                }
              }
            }
          ]
        }
      }
    ]
  }
  ```

Замечания:
- Левый/правый операнды могут быть выражениями вида (метрика ⊕ операнд), где ⊕ ∈ {+,-,*,/}.
- Для `leg`‑метрик в position‑цепочке требуется `legMode: 'symbol'` и явный `symbol`.
- Сравнение выполняется только при наличии валидных чисел; отсутствующие/NaN считаются «нет данных» и условие игнорируется (не удовлетворено).

**Приложение H — Сценарий settlement и авто‑закрытия**

- Детект истекших экспираций: если `expiryMs <= now` для опционной ноги и нет `settlements[expiryMs]`, позиция помечается как «partial/expired»; запускается попытка авто‑получения цены экспирации.
- Получение цены:
  1) `GET /v5/market/delivery-price?category=option&symbol=<SYMBOL>[&settleCoin=USDT]` → берем `deliveryPrice`/`markPrice`/`price`/`settlePrice` первое валидное.
  2) Если пусто — `GET /v5/market/delivery-history?category=option&baseCoin=ETH[&settleCoin=USDT]`, ищем запись по `symbol`.
- Запись в стор: `setSpreadSettlement`/`setPositionSettlement(id, expiryMs, value)` → `settlements[String(expiryMs)] = { settleUnderlying: value, settledAt: now }`.
- Визуализация: в модалке SettleExpired показываются ноги и авто‑подставленные `settleUnderlying`; после применения — состояние строки обновляется, а при истечении всех опционных ног позиция автоматически закрывается.
