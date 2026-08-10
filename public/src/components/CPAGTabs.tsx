import type { CpagTab } from '../utils/cpag-types';
import UITabNav from './UITabNav';

interface CPAGTabsProps {
  activeTab: CpagTab;
  setActiveTab: (tab: CpagTab) => void;
}

type CpagTabVisivel = Exclude<CpagTab, 'recibos'>;

const tabs: Array<{ id: CpagTabVisivel; label: string; icon: string }> = [
  { id: 'comissao', label: 'Comissão', icon: 'fa-percent' },
  { id: 'bonus', label: 'Bônus e Premiações', icon: 'fa-star' },
  { id: 'passagem', label: 'Passagem', icon: 'fa-bus-alt' },
  { id: 'salario', label: 'Salário', icon: 'fa-file-invoice-dollar' },
  { id: 'beneficios', label: 'Benefícios', icon: 'fa-gift' },
];

const permissaoPorAba: Record<CpagTabVisivel, string> = {
  comissao: 'permitir-pagar-comissao',
  bonus: 'permitir-conceder-bonus',
  passagem: 'permitir-pagar-passagens',
  salario: 'permitir-pagar-salarios',
  beneficios: 'permitir-pagar-beneficios',
};

export default function CPAGTabs({ activeTab, setActiveTab }: CPAGTabsProps) {
  return (
    <UITabNav
      ariaLabel="Tipos de pagamento"
      activeId={activeTab}
      onChange={(id) => setActiveTab(id as CpagTab)}
      items={tabs.map((tab) => ({
        ...tab,
        locked: { permissao: permissaoPorAba[tab.id] },
      }))}
    />
  );
}
