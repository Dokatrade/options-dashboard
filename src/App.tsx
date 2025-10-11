import React from 'react';
import { MarketContextCard } from './components/MarketContextCard';
import { PortfolioSummary } from './components/PortfolioSummary';
import { UnifiedPositionsTable } from './components/UnifiedPositionsTable';
import { HelpModal } from './components/HelpModal';
import { SlowModeProvider } from './contexts/SlowModeContext';
import { TopBarBackupButtons } from './components/TopBarBackupButtons';
import { PortfolioManagerModal } from './components/PortfolioManagerModal';
import { PortfolioSummaryReport } from './components/PortfolioSummaryReport';

export default function App() {
  const [help, setHelp] = React.useState(false);
  const [showPortfolioManager, setShowPortfolioManager] = React.useState(false);
  const [summaryPortfolioId, setSummaryPortfolioId] = React.useState<string | null>(null);
  const showSummary = summaryPortfolioId != null;
  return (
    <SlowModeProvider>
      <div className="container">
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom: 8}}>
          <h2 style={{margin: 0}}>ETH Options Dashboard (Bybit Public API)</h2>
          <div style={{display:'flex', gap:8, alignItems:'center'}}>
            <TopBarBackupButtons />
            <button className="ghost" onClick={() => setShowPortfolioManager(true)}>Manage Portfolios</button>
            <button className="ghost" onClick={() => setHelp(true)}>Help</button>
          </div>
        </div>
        {showSummary ? (
          <div className="row">
            <div className="card" style={{ flex: 1 }}>
              <PortfolioSummaryReport
                portfolioId={summaryPortfolioId as string}
                onBack={() => setSummaryPortfolioId(null)}
              />
            </div>
          </div>
        ) : (
          <>
            <div className="row">
              <div className="card" style={{flex: 2}}>
                <MarketContextCard />
              </div>
              <div className="card" style={{flex: 1}}>
                <PortfolioSummary onOpenSummary={(id) => setSummaryPortfolioId(id)} />
              </div>
            </div>
            <div className="row">
              <div className="card" style={{flex: 1}}>
                <UnifiedPositionsTable />
              </div>
            </div>
          </>
        )}
        {help && <HelpModal onClose={() => setHelp(false)} />}
        {showPortfolioManager && (
          <PortfolioManagerModal
            onClose={() => setShowPortfolioManager(false)}
            onOpenSummary={(id) => {
              setSummaryPortfolioId(id);
              setShowPortfolioManager(false);
            }}
          />
        )}
      </div>
    </SlowModeProvider>
  );
}
