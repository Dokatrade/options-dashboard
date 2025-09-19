import React from 'react';
import { MarketContextCard } from './components/MarketContextCard';
import { PortfolioSummary } from './components/PortfolioSummary';
import { AddPosition } from './components/AddPosition';
import { UnifiedPositionsTable } from './components/UnifiedPositionsTable';
import { HelpModal } from './components/HelpModal';
import { SlowModeProvider } from './contexts/SlowModeContext';

export default function App() {
  const [help, setHelp] = React.useState(false);
  return (
    <SlowModeProvider>
      <div className="container">
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <h2 style={{margin: 0}}>ETH Options Dashboard (Bybit Public API)</h2>
          <div>
            <button className="ghost" onClick={() => setHelp(true)}>Help</button>
          </div>
        </div>
        <div className="row">
          <div className="card" style={{flex: 2}}>
            <MarketContextCard />
          </div>
          <div className="card" style={{flex: 1}}>
            <PortfolioSummary />
          </div>
        </div>
        <div className="row">
          <div className="card" style={{flex: 1}}>
            <AddPosition />
          </div>
        </div>
        <div className="row">
          <div className="card" style={{flex: 1}}>
            <UnifiedPositionsTable />
          </div>
        </div>
        {help && <HelpModal onClose={() => setHelp(false)} />}
      </div>
    </SlowModeProvider>
  );
}
