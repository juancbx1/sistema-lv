import type { CpagTab } from '../utils/cpag-types';
import UITabNav from './UITabNav';

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
    <UITabNav
      ariaLabel="Tipos de pagamento"
      activeId={activeTab}
      onChange={(id) => setActiveTab(id as CpagTab)}
      items={tabs}
    />
  );
}
