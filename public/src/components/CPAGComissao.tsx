import React, { useState, useEffect } from 'react';
import Select, { components } from 'react-select';
import type { CpagContaFinanceira, CpagUsuario } from '../utils/cpag-types';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import CPAGModalReciboComissao from './CPAGModalReciboComissao';

interface SelectOption { value: number | string; label: string; }
interface CicloOption extends SelectOption { jaFoiPago: boolean; mesIndex: number; ano: number; }
interface HistoricoPagamento { usuario_id: number | string; ciclo_nome?: string; }
interface DiaComissao { data: string; pontosProduzidos: number; pontosExtras: number; pontosResgatados: number; totalPontos: number; meta: string; valor: number; }
interface ResultadoCalculo { proventos: { comissao: number }; dadosDetalhados?: { resumo?: { totalProduzido: number; totalResgatado: number }; dias?: DiaComissao[] }; [key: string]: unknown; }

const CustomNoOptions = (props: any) => (
    <components.NoOptionsMessage {...props}>
        <div style={{ padding: '10px' }}>
            <UIFeedbackNotFound icon="fa-search" titulo="Sem resultados" mensagem="Nenhum registro encontrado." />
        </div>
    </components.NoOptionsMessage>
);

interface Props { usuarios: CpagUsuario[]; contas: CpagContaFinanceira[]; }

export default function CPAGComissao({ usuarios, contas }: Props) {
    const [userId, setUserId] = useState('');
    const [cicloSelecionado, setCicloSelecionado] = useState<CicloOption | null>(null);
    const [opcoesCiclo, setOpcoesCiclo] = useState<CicloOption[]>([]);
    const [resultadoCalculo, setResultadoCalculo] = useState<ResultadoCalculo | null>(null);
    const [historicoPagamentos, setHistoricoPagamentos] = useState<HistoricoPagamento[]>([]);
    const [pagamentoBloqueado, setPagamentoBloqueado] = useState(false);
    const [mensagemBloqueio, setMensagemBloqueio] = useState('');
    const [modalReciboAberto, setModalReciboAberto] = useState(false);
    const [contaId, setContaId] = useState(''); // Usando contaId simples em vez de objeto Select pra facilitar

    // UI states...
    const [loadingCalculo, setLoadingCalculo] = useState(false);
    const [loadingPagamento, setLoadingPagamento] = useState(false);

     // Transforma a lista de usuários para o formato do React Select
    const userOptions = usuarios.map(u => ({ value: u.id, label: u.nome }));

    // O estado userId agora deve guardar o OBJETO inteiro do select, não só o ID
    // Então deve-se renomear para ficar claro:
    const [selectedUser, setSelectedUser] = useState<SelectOption | null>(null);

    useEffect(() => {
        async function fetchHistorico() {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/pagamentos/historico', {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                setHistoricoPagamentos(data);
            } catch (err) { console.error(err); }
        }
        fetchHistorico();
    }, []);

    // 2. Gera opções de Ciclo (COM A TRAVA DE DATA)
    useEffect(() => {
        if (!selectedUser) {
            setOpcoesCiclo([]);
            setCicloSelecionado(null);
            setResultadoCalculo(null);
            return;
        }

        const hoje = new Date();
        const diaHoje = hoje.getDate();
        let cursor = new Date(hoje.getFullYear(), hoje.getMonth(), 1);

        if (diaHoje >= 21) {
            cursor.setMonth(cursor.getMonth() + 1);
        }

        // DATA LIMITE: Dezembro de 2025.
        // Em JS, meses são 0-indexados, então Dezembro é 11.
        const dataLimite = new Date(2025, 11, 1); // 01/Dez/2025

        const novasOpcoes: CicloOption[] = [];
        // Loop de segurança (máximo 12 meses pra trás, ou até bater na data limite)
        for (let i = 0; i < 12; i++) {

            // --- AQUI ESTÁ A TRAVA MÁGICA ---
            if (cursor < dataLimite) {
                break; // Para o loop se for antes de Dez/25
            }
            // -------------------------------

            const nomeMes = cursor.toLocaleString('pt-BR', { month: 'long' });
            const ano = cursor.getFullYear();
            const nomeFormatado = nomeMes.charAt(0).toUpperCase() + nomeMes.slice(1);
            const valorCompetencia = `${nomeFormatado}/${ano}`;

            const jaFoiPago = historicoPagamentos.some(
                p => p.usuario_id == selectedUser.value && p.ciclo_nome === valorCompetencia
            );

            // Regra de fechamento (dia 20)
            const dataFechamento = new Date(ano, cursor.getMonth(), 20, 23, 59, 59);
            const cicloFechado = hoje > dataFechamento;

            let label = valorCompetencia;
            if (jaFoiPago) label += ' [PAGO]';
            else if (!cicloFechado) label += ' (Em aberto)';

            novasOpcoes.push({
                value: valorCompetencia,
                label: label,
                jaFoiPago,
                mesIndex: cursor.getMonth(),
                ano: cursor.getFullYear()
            });

            cursor.setMonth(cursor.getMonth() - 1);
        }
        setOpcoesCiclo(novasOpcoes);
    }, [selectedUser, historicoPagamentos]);

    useEffect(() => {
        if (!cicloSelecionado) {
            setPagamentoBloqueado(false);
            return;
        }
        const anoCiclo = cicloSelecionado.ano;
        const mesCiclo = cicloSelecionado.mesIndex;
        // Libera dia 14 do mês seguinte
        const dataLiberacao = new Date(anoCiclo, mesCiclo + 1, 14, 0, 0, 0);
        const hoje = new Date();

        if (hoje < dataLiberacao) {
            setPagamentoBloqueado(true);
            const dataPagamentoFormatada = new Date(anoCiclo, mesCiclo + 1, 15).toLocaleDateString('pt-BR');
            setMensagemBloqueio(`Data oficial de pagamento: ${dataPagamentoFormatada}. Liberado a partir do dia 14.`);
        } else {
            setPagamentoBloqueado(false);
            setMensagemBloqueio('');
        }
    }, [cicloSelecionado]);

    useEffect(() => {
        if (!selectedUser || !cicloSelecionado) {
            setResultadoCalculo(null);
            return;
        }

        async function calcular() {
            setLoadingCalculo(true);
            try {
                const token = localStorage.getItem('token');
                const params = new URLSearchParams({
                    usuario_id: String(selectedUser!.value),
                    competencia: String(cicloSelecionado!.value),
                    tipo_pagamento: 'COMISSAO'
                });

                const res = await fetch(`/api/pagamentos/calcular?${params}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if(!res.ok) throw new Error('Erro ao calcular');
                const data = await res.json();
                setResultadoCalculo(data);
            } catch (err) {
                console.error(err);
                // EM VEZ DE setErro, usamos Toast, mas apenas se for um erro "real" de interação
                // Para carregamento inicial silencioso, talvez console.error baste,
                // mas aqui vamos avisar o usuário que falhou.
                mostrarToast("Não foi possível calcular. Verifique as metas.", 'erro');
            } finally {
                setLoadingCalculo(false);
            }
        }
        calcular();
    }, [selectedUser, cicloSelecionado]);


    const handlePagar = async () => {
        if (!contaId) {
            mostrarToast("Selecione uma conta para débito.", 'aviso');
            return;
        }

        if (!resultadoCalculo || !selectedUser || !cicloSelecionado) return;
        const confirmado = await mostrarConfirmacao(
            `Confirma o pagamento de ${formatarMoeda(resultadoCalculo.proventos.comissao)}?`,
            { tipo: 'aviso', textoConfirmar: 'Pagar Agora' }
        );
        if(!confirmado) return;

        setLoadingPagamento(true);
        try {
            const token = localStorage.getItem('token');
            const payload = {
                calculo: resultadoCalculo,
                id_conta_debito: parseInt(contaId)
            };

            const res = await fetch('/api/pagamentos/efetuar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (!res.ok) throw new Error(data.error);

            mostrarToast(data.message, 'sucesso'); // TOAST SUCESSO
            setResultadoCalculo(null);
            setHistoricoPagamentos((prev) => [...prev, { usuario_id: selectedUser!.value, ciclo_nome: String(cicloSelecionado!.value) }]);

        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro ao pagar comissão.', 'erro'); // TOAST ERRO
        } finally {
            setLoadingPagamento(false);
        }
    };

    // Helper seguro para evitar crash
    const resumoSeguro = resultadoCalculo?.dadosDetalhados?.resumo || { totalProduzido: 0, totalResgatado: 0 };
    const diasSeguros = resultadoCalculo?.dadosDetalhados?.dias || [];

    const renderTabelaDias = () => {
        if (diasSeguros.length === 0) return <p style={{textAlign:'center', color:'#999'}}>Sem dados diários.</p>;

        return (
            <div className="cpg-tabela-container">
                <table className="cpg-tabela-detalhes">
                    <thead>
                        <tr>
                            <th>Data</th>
                            <th style={{textAlign: 'center'}}>Produção</th>
                            <th style={{textAlign: 'center'}}>Extras</th>
                            <th style={{textAlign: 'center'}}>Resgate</th>
                            <th style={{textAlign: 'center', backgroundColor: '#f0f0f0'}}>Total Dia</th>
                            <th style={{textAlign: 'center'}}>Meta</th>
                            <th style={{textAlign: 'right'}}>Comissão</th>
                        </tr>
                    </thead>
                    <tbody>
                        {diasSeguros.map((dia, idx) => (
                            <tr key={idx}>
                                <td>{dia.data}</td>
                                <td style={{textAlign: 'center'}}>{Math.round(dia.pontosProduzidos)}</td>
                                <td style={{textAlign: 'center', color: dia.pontosExtras > 0 ? '#27ae60' : '#ccc'}}>
                                    {dia.pontosExtras > 0 ? `+${Math.round(dia.pontosExtras)}` : '-'}
                                </td>
                                <td style={{textAlign: 'center', color: dia.pontosResgatados > 0 ? '#27ae60' : '#ccc'}}>
                                    {dia.pontosResgatados > 0 ? `+${Math.round(dia.pontosResgatados)}` : '-'}
                                </td>
                                <td style={{textAlign: 'center', fontWeight: 'bold', backgroundColor: '#f9f9f9'}}>
                                    {Math.round(dia.totalPontos)}
                                </td>
                                <td style={{textAlign: 'center'}}>{dia.meta}</td>
                                <td style={{textAlign: 'right', color: dia.valor > 0 ? '#27ae60' : '#999', fontWeight: dia.valor > 0 ? 'bold' : 'normal'}}>
                                    {formatarMoeda(dia.valor)}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    };

    const competenciaJaPaga = cicloSelecionado?.jaFoiPago

    return (
        <div className="cpg-card">
            {/* Header Flex com Título e Botão */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px', borderBottom:'1px solid #e9ecef', paddingBottom:'10px'}}>
                <h2 className="cpg-section-title" style={{border:'none', margin:0, padding:0}}>Cálculo de Comissão por Ciclo</h2>
                <button
                    className="cpg-btn cpg-btn-secundario"
                    onClick={() => setModalReciboAberto(true)}
                >
                    <i className="fas fa-file-invoice"></i> Recibos Semanais
                </button>
            </div>

            <div className="cpg-form-row">
                <div className="cpg-form-group">
                    <label>Empregado</label>
                    <Select
                        options={userOptions}
                        value={selectedUser}
                        onChange={setSelectedUser}
                        placeholder="Buscar empregado..."
                        isClearable
                        components={{ NoOptionsMessage: CustomNoOptions }}
                    />
                </div>

                <div className="cpg-form-group">
                    <label>Competência</label>
                    <Select
                        options={opcoesCiclo}
                        value={cicloSelecionado}
                        onChange={setCicloSelecionado}
                        placeholder="Selecione a competência..."
                        isDisabled={!selectedUser}
                        components={{ NoOptionsMessage: CustomNoOptions }}
                        noOptionsMessage={() => "Nenhuma competência disponível (apenas Dez/25+)"}
                        styles={{ control: (base) => ({ ...base, borderColor: '#ced4da', borderRadius: '6px' }) }}
                    />
                </div>
            </div>

            {pagamentoBloqueado && !competenciaJaPaga && resultadoCalculo && (
                <div style={{padding: 10, backgroundColor: '#fff3cd', color: '#856404', marginBottom: 15, borderRadius: 5, border: '1px solid #ffeeba'}}>
                    <i className="fas fa-clock"></i> <strong>Aguardando data:</strong> {mensagemBloqueio}
                </div>
            )}

            {loadingCalculo && <div className="cpg-spinner"><span>Calculando...</span></div>}

            {!loadingCalculo && resultadoCalculo && (
                <div className="cpg-resultado-comissao">
                    <div className="cpg-resumo-grid">
                        <div className="cpg-resumo-card">
                            <p className="label">Pontos Produzidos</p>
                            <p className="valor">{Math.round(resumoSeguro.totalProduzido)}</p>
                        </div>
                        <div className="cpg-resumo-card">
                            <p className="label">Resgatados (Cofre)</p>
                            <p className="valor" style={{color: 'var(--cpg-cor-primaria)'}}>{Math.round(resumoSeguro.totalResgatado)}</p>
                        </div>
                        <div className="cpg-resumo-card">
                            <p className="label">{competenciaJaPaga ? 'Valor Pago' : 'Total a Pagar'}</p>
                            <p className={`valor ${!competenciaJaPaga ? 'positivo' : ''}`}>
                                {formatarMoeda(resultadoCalculo.proventos.comissao)}
                            </p>
                        </div>
                    </div>

                    <h3 className="cpg-section-title" style={{marginTop: 30, fontSize: '1rem'}}>Extrato Diário</h3>
                    {renderTabelaDias()}

                    {competenciaJaPaga ? (
                        <div className="cpg-card" style={{marginTop: 30, backgroundColor: '#e8f5e9', borderLeft: '5px solid #27ae60'}}>
                             <h3 style={{margin:0, color: '#27ae60'}}><i className="fas fa-check-circle"></i> Comissão Paga</h3>
                             <p>Referente à competência <strong>{cicloSelecionado?.label}</strong>.</p>
                        </div>
                    ) : (
                        resultadoCalculo.proventos.comissao > 0 ? (
                            <div className="cpg-card" style={{marginTop: 30, backgroundColor: '#fcfcfc'}}>
                                <h3 className="cpg-section-title">Efetuar Pagamento</h3>
                                <div className="cpg-form-row">
                                    <div className="cpg-form-group">
                                        <label>Debitar da Conta Financeira*</label>
                                        <Select
                                            // Transformamos a lista de contas em opções {value, label}
                                            options={contas.map(c => ({ value: String(c.id), label: c.nome_conta }))}

                                            // Encontramos o objeto atual baseado no ID salvo no state
                                            value={contas.find(c => String(c.id) === contaId) ? { value: contaId, label: contas.find(c => String(c.id) === contaId)!.nome_conta } : null}

                                            // Ao mudar, salvamos apenas o ID (value) no state para não quebrar a função handlePagar
                                            onChange={opt => setContaId(opt ? opt.value : '')}

                                            placeholder="Selecione..."
                                            isDisabled={pagamentoBloqueado}
                                            // ADICIONADO:
                                            components={{ NoOptionsMessage: CustomNoOptions }}
                                        />
                                    </div>

                                    <div className="cpg-form-group" style={{alignSelf: 'flex-end'}}>
                                        <button
                                            className="cpg-btn cpg-btn-primario"
                                            style={{width: '100%'}}
                                            onClick={handlePagar}
                                            disabled={loadingPagamento || pagamentoBloqueado}
                                            title={pagamentoBloqueado ? mensagemBloqueio : ''}
                                        >
                                            {loadingPagamento ? 'Processando...' : 'Pagar Comissão'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <p style={{textAlign:'center', marginTop: 20, color: '#999'}}>Nenhum valor gerado para pagamento.</p>
                        )
                    )}
                </div>
            )}

            {/* MODAL DE RECIBOS */}
            <CPAGModalReciboComissao
                isOpen={modalReciboAberto}
                onClose={() => setModalReciboAberto(false)}
                usuarios={usuarios}
            />

        </div>
    );
}
