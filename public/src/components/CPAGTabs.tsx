import type { CpagTab } from '../utils/cpag-types';

interface CPAGTabsProps {
  activeTab: CpagTab;
  setActiveTab: (tab: CpagTab) => void;
}

const tabs: Array<{ id: CpagTab; label: string; icon: string }> = [
  { id: 'comissao', label: 'Comissão', icon: 'fa-percent' },
  { id: 'bonus', label: 'Bônus e Premiações', icon: 'fa-star' },
  { id: 'passagem', label: 'Passagem', icon: 'fa-bus-alt' },
  { id: 'salario', label: 'Salário', icon: 'fa-file-invoice-dollar' },
  { id: 'beneficios', label: 'Benefícios', icon: 'fa-gift' },
];

export default function CPAGTabs({ activeTab, setActiveTab }: CPAGTabsProps) {
  return (
    <nav className="gs-tab-nav" role="tablist" aria-label="Tipos de pagamento">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={activeTab === tab.id}
          className={`gs-tab-btn ${activeTab === tab.id ? 'ativo' : ''}`}
          onClick={() => setActiveTab(tab.id)}
        >
          <i className={`fas ${tab.icon}`} aria-hidden="true"></i>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
