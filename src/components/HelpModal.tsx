import React from 'react';

type Props = { onClose: () => void };

export function HelpModal({ onClose }: Props) {
  return (
    <div style={{position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60}}>
      <div style={{background: 'var(--card)', color: 'var(--fg)', border: '1px solid var(--border)', borderRadius: 12, width: 800, maxWidth: '95%', maxHeight: '90%', overflow: 'auto', boxShadow: '0 10px 30px rgba(0,0,0,.35)'}}>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)'}}>
          <strong>Справка — ETH Options Dashboard</strong>
          <button className="ghost" onClick={onClose}>Закрыть</button>
        </div>
        <div style={{padding: 16, lineHeight: 1.4}}>
          <p><strong>Что это</strong></p>
          <ul>
            <li><strong>Локальная</strong> панель для мониторинга и конструирования опционных позиций по ETH (Bybit), без API‑ключей.</li>
            <li>Работает с <strong>вертикальными спредами</strong> (PUT/CALL) и <strong>мульти‑ногими</strong> позициями (календарь и любые комбинации).</li>
            <li>Данные в реальном времени через публичные <strong>WebSocket</strong>; REST — для инициализации и HV30.</li>
          </ul>

          <p><strong>Быстрый старт</strong></p>
          <ul>
            <li>Откройте <em>Add Position</em>. Выберите <strong>Type</strong> (PUT/CALL), <strong>Expiry</strong>, затем <strong>Option</strong> со списком страйков и живой ценой.</li>
            <li>Укажите <strong>Volume (qty)</strong> с шагом 0.1 и нажмите <strong>Add Short</strong> или <strong>Add Long</strong> — нога добавится в <em>Position builder</em>.</li>
            <li>Соберите 2 ноги одинаковой экспирации и противоположных сторон — можно сохранить как <strong>вертикальный спред</strong>.</li>
            <li>Любую другую комбинацию сохраните как <strong>multi‑leg позицию</strong>.</li>
            <li>Черновик билдерa <strong>автосохраняется</strong> и переживает перезагрузку; кнопка <em>Clear draft</em> его очищает.</li>
          </ul>

          <p><strong>My Positions (единая таблица)</strong></p>
          <ul>
            <li><strong>Type</strong>: Vertical или Multi‑leg (определяется автоматически).</li>
            <li><strong>Net entry / Net mid / PnL</strong>: суммы по всем ногам с учетом знака стороны и <strong>qty</strong>.</li>
            <li><strong>Greeks (Δ/Γ/Vega/Θ)</strong>: суммирование по ногам; для коротких ног знак инвертируется.</li>
            <li><strong>Liquidity</strong>: максимальный bid‑ask спред по ногам и минимальный OI. Данные берутся из WS; если отсутствуют — подкачиваются из REST.</li>
            <li><strong>Бэйджи ликвидности</strong> (все серые):
              <div style={{marginTop:4}}>
                <code style={{background:'var(--card)', padding:'1px 6px', borderRadius:8}}>A</code> / <code style={{background:'var(--card)', padding:'1px 6px', borderRadius:8}}>B</code> / <code style={{background:'var(--card)', padding:'1px 6px', borderRadius:8}}>C</code> / <code style={{background:'var(--card)', padding:'1px 6px', borderRadius:8}}>D</code>
              </div>
              <ul>
                <li>A: <em>spread%</em> &lt; 1% и <em>min OI</em> ≥ 2000</li>
                <li>B: <em>spread%</em> &lt; 2% и <em>min OI</em> ≥ 1000</li>
                <li>C: <em>spread%</em> &lt; 3% и <em>min OI</em> ≥ 300</li>
                <li>D: иначе</li>
              </ul>
              <div className="muted">Как считаем: для каждой ноги spread% = (Ask − Bid) / Mid × 100, затем берём <strong>максимум</strong> spread% по ногам и <strong>минимум</strong> OI. Меньше спред и выше OI — лучше. Низкая ликвидность повышает риск проскальзывания, сложнее исполнение лимитами и переносы (roll).</div>
              <div className="muted" style={{marginTop:4}}>Для многоногих конструкций оценка считается по <strong>всем</strong> ногам: берём самое «узкое место» — наибольший spread% среди ног и наименьший OI. Если по части ног нет котировок (bid/ask или OI), бэйдж может понизиться из‑за неполных данных.</div>
            </li>
            <li><strong>Vertical extras</strong>: для вертикалей показываются <em>Width</em>, <em>MaxLoss</em> (с учетом qty) и <em>DTE</em>.</li>
            <li><strong>Действия</strong>: View (для вертикалей, payoff‑график), Edit (для multi‑leg), Mark closed, Delete, Export CSV.</li>
          </ul>

          <p><strong>Edit (multi‑leg)</strong></p>
          <ul>
            <li>Меняйте <strong>qty</strong> каждой ноги (шаг 0.1) и удаляйте лишние ноги.</li>
            <li><strong>Add leg</strong>: добавляйте новые ноги по Type/Expiry/Option; <em>entryPrice</em> берётся по текущему mid.</li>
            <li><strong>Roll helper</strong>: выберите существующую ногу, целевую экспирацию и опцион — кнопка добавит пару ног (закрытие старой и открытие новой) с entry по текущему mid.</li>
          </ul>

          <p><strong>Расчёты и определения</strong></p>
          <ul>
            <li><strong>Mid</strong> ≈ (bid + ask)/2; если нет bid/ask в WS, подкачиваем из REST.</li>
            <li><strong>PnL</strong> = Net entry − Net mid (учитывает qty и стороны).</li>
            <li><strong>Vertical PUT</strong>: BE = K_sell − C_enter; payoff: слева −MaxLoss → справа +C_enter.</li>
            <li><strong>Vertical CALL</strong>: BE = K_sell + C_enter; payoff: слева +C_enter → справа −MaxLoss.</li>
            <li><strong>MaxLoss</strong> = (Width − C_enter) × qty, только для <em>вертикалей одной экспирации</em>.</li>
            <li><strong>Portfolio</strong>: Total MaxLoss учитывает только вертикали; доля от депозита = MaxLossSum / Deposit.</li>
          </ul>

          <p><strong>Показатель Δσ (Vol Edge)</strong></p>
          <ul>
            <li><strong>Определение</strong>: Δσ = IV_mid − σ_ref, в волатильностных пунктах (п.п.). Положительное — «rich», отрицательное — «cheap».</li>
            <li><strong>IV_mid</strong>: implied vol, инвертированная из <em>mid</em> (среднее bid/ask) модели Блэка–Шоулза по ноге.</li>
            <li><strong>σ_ref (бенчмарк)</strong>: приоритет источников — <em>markIv</em> (Bybit) → IV из <em>markPrice</em> → IV из книги (среднее bid/ask) → <em>HV30</em>.</li>
            <li><strong>Входные для IV</strong>:
              <div className="muted">S = индекс базового актива (Index), K и expiry из контракта, T — доля года до экспирации от «сейчас», r — параметр <em>Rate (r)</em> из окна View.</div>
            </li>
            <li><strong>Бэйдж</strong> рядом со значением: [↑] если Δσ ≥ +1.0 п.п. («rich»), [↓] если Δσ ≤ −1.0 п.п. («cheap»), иначе [–]. Пример: <code>1.6 [↑]</code>.</li>
            <li><strong>Интерпретация</strong>:
              <div className="muted">Rich → рынок котирует волу выше бенчмарка (продавцу выгоднее), Cheap → ниже бенчмарка (покупателю выгоднее).</div>
            </li>
            <li><strong>Практические кейсы</strong>:
              <div className="muted">Rich: skew/smile (дорогие OTM), ожидание события, премия за инвентарь маркет‑мейкера, тонкая ликвидность/широкий спред. Cheap: спад спроса после события, избыток продавцов, локальная дислокация книги.</div>
            </li>
            <li><strong>Замечания</strong>:
              <div className="muted">При очень малой vega дальних OTM Δσ шумный; учитывайте спред и комиссии. Для оценки денежного эффекта: Edge$ ≈ Vega × Δσ.</div>
            </li>
          </ul>

          <p><strong>Маркет‑данные</strong></p>
          <ul>
            <li><strong>Spot</strong> ETH и 24h% — по WS спота.</li>
            <li><strong>ATM IV</strong> — берётся у контракта ближайшего к деньгам на ближайшей экспирации (WS + стартовый REST).</li>
            <li><strong>HV 30d</strong> — с REST; при недоступности временно показываем ATM IV как прокси.</li>
          </ul>

          <p><strong>Сохранение и экспорт</strong></p>
          <ul>
            <li>Все данные пользователя хранятся локально (localStorage). Бэкап: <strong>Export/Import JSON</strong> в Portfolio.</li>
            <li>В My Positions доступен <strong>Export CSV</strong> текущего списка (включая multi‑leg).</li>
          </ul>

          <p className="muted"><strong>Важно</strong>: инструмент учебный и не является инвестрекомендацией. Проверяйте котировки и расчёты на бирже перед действиями. Волатильность, проскальзывание и ликвидность могут существенно влиять на результаты.</p>
        </div>
      </div>
    </div>
  );
}
