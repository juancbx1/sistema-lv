import { useEffect, useState } from 'react';
import CPAGTabs from './CPAGTabs';
import UIHeaderPagina from './UIHeaderPagina';
import CPAGComissao from './CPAGComissao';
import CPAGBonus from './CPAGBonus';
import CPAGPassagem from './CPAGPassagem';
import CPAGSalario from './CPAGSalario';
import CPAGBeneficios from './CPAGBeneficios';
import UICarregando from './UICarregando';
import { fetchCpag } from '../utils/cpag-api';
import type {
  CpagConfiguracoesFinanceiras,
  CpagContaFinanceira,
  CpagTab,
  CpagUsuario,
} from '../utils/cpag-types';

interface Props {
  permissoes: string[];
}

export default function CPAGCentralPagamentos({ permissoes }: Props) {
  const [activeTab, setActiveTab] = useState<CpagTab>('comissao');
  const [usuarios, setUsuarios] = useState<CpagUsuario[]>([]);
  const [contasFinanceiras, setContasFinanceiras] = useState<CpagContaFinanceira[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const carregarDadosIniciais = async () => {
      try {
        const [usersData, finData] = await Promise.all([
          fetchCpag<CpagUsuario[]>('/api/usuarios'),
          fetchCpag<CpagConfiguracoesFinanceiras>('/api/financeiro/configuracoes'),
        ]);
        if (!ativo) return;
        const elegiveis = (Array.isArray(usersData) ? usersData : [])
          .filter(
            (usuario) =>
              usuario.elegivel_pagamento === true &&
              Boolean(usuario.data_admissao) &&
              !usuario.data_demissao,
          )
          .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        setUsuarios(elegiveis);
        setContasFinanceiras(finData.contas ?? []);
      } catch (error) {
        if (ativo) {
          setErro(error instanceof Error ? error.message : 'Erro ao carregar dados do sistema.');
        }
      } finally {
        if (ativo) setLoading(false);
      }
    };
    void carregarDadosIniciais();
    return () => {
      ativo = false;
    };
  }, []);

  if (loading) {
    return <UICarregando variante="pagina" tamanho="lg" texto="Carregando dados..." />;
  }

  if (erro) {
    return (
      <div className="cpg-card" role="alert">
        <h2>Não foi possível carregar a Central de Pagamentos</h2>
        <p>{erro}</p>
        <button
          type="button"
          className="cpg-btn cpg-btn-primario"
          onClick={() => window.location.reload()}
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <>
      <UIHeaderPagina titulo="Central de Pagamentos" children={null} />
      <CPAGTabs activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="gs-conteudo-pagina">
        {activeTab === 'comissao' && (
          <CPAGComissao usuarios={usuarios} contas={contasFinanceiras} />
        )}
        {activeTab === 'bonus' && <CPAGBonus usuarios={usuarios} contas={contasFinanceiras} />}
        {activeTab === 'passagem' && (
          <CPAGPassagem usuarios={usuarios} contas={contasFinanceiras} />
        )}
        {activeTab === 'salario' && <CPAGSalario usuarios={usuarios} contas={contasFinanceiras} />}
        {activeTab === 'beneficios' && (
          <CPAGBeneficios usuarios={usuarios} contas={contasFinanceiras} />
        )}
      </div>
      {/* Permissão de entrada já validada no boot; lista mantida para auditoria acessível. */}
      <span className="sr-only">Permissões carregadas: {permissoes.length}</span>
    </>
  );
}
