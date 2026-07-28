import React, { useState, useEffect } from 'react';
import Select, { components } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarConfirmacao, mostrarToast } from '../utils/cpag-feedback';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import CPAGMultiDatePicker from './CPAGMultiDatePicker.tsx';
import CPAGModalHistoricoVT from './CPAGModalHistoricoVT.tsx';
import CPAGGerenciadorRecibosVT from './CPAGGerenciadorRecibosVT.tsx';

interface Props { usuarios: any[]; contas: any[]; }
interface ConcessionariaOption { value: number | string; label: string; taxa_recarga_percentual?: number | string; id_contato_financeiro?: number | string | null; }
interface FuncionarioOption { value: number | string; label: string; }

const CustomNoOptions = (props: any) => (
    <components.NoOptionsMessage {...props}>
        <div style={{ padding: '10px' }}>
            <UIFeedbackNotFound icon="fa-search" titulo="Sem resultados" mensagem="Nenhum registro encontrado." />
        </div>
    </components.NoOptionsMessage>
);

export default function CPAGPassagem({ usuarios, contas }: Props) {
    // --- ESTADOS ---
    const [concessionarias, setConcessionarias] = useState<any[]>([]);
    const [selConcessionaria, setSelConcessionaria] = useState<ConcessionariaOption | null>(null);
    const [selConta, setSelConta] = useState<FuncionarioOption | null>(null);

    // CALENDÁRIO MESTRE
    const [diasGlobais, setDiasGlobais] = useState<string[]>([]); // ['2026-01-12', '2026-01-13']

    // SELEÇÃO E DADOS
    const [selFuncionarios, setSelFuncionarios] = useState<FuncionarioOption[]>([]);

    // MAPA DE EXCEÇÕES: { [id_usuario]: ['data1', 'data2'] }
    // Se o usuário não estiver aqui, ele usa o diasGlobais.
    // Se estiver aqui, ele usa o array específico dele.
    const [diasEspecificos, setDiasEspecificos] = useState<Record<string, string[]>>({});

    // MODAIS
    const [modalUserAberto, setModalUserAberto] = useState(null); // ID do usuário sendo editado
    const [modalRecibosAberto, setModalRecibosAberto] = useState(false);
    const [diasPagosUsuarioAtual, setDiasPagosUsuarioAtual] = useState<string[]>([]);
    const [loadingDiasUser, setLoadingDiasUser] = useState(false);
    const [modalHistoricoAberto, setModalHistoricoAberto] = useState(false);
    const [usuarioParaHistorico, setUsuarioParaHistorico] = useState<number | string | null>(null);

    // FINANCEIRO
    const [taxaManual, setTaxaManual] = useState('');
    const [loading, setLoading] = useState(false);

    // Função para abrir o modal de edição individual e buscar os dias já pagos
    const handleAbrirEdicaoUsuario = async (usuarioId: number | string) => {
        setModalUserAberto(usuarioId as any);
        setDiasPagosUsuarioAtual([]);
        setLoadingDiasUser(true);

        // Define um intervalo amplo para buscar (ex: mês atual e próximo)
        // Para simplificar, pegamos 60 dias pra frente e pra trás da data de hoje ou do filtro
        const hoje = new Date();
        const start = new Date(hoje.setDate(hoje.getDate() - 30)).toISOString().split('T')[0];
        const end = new Date(hoje.setDate(hoje.getDate() + 90)).toISOString().split('T')[0];

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/pagamentos/registros-dias?usuario_id=${usuarioId}&start=${start}&end=${end}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const eventos = await res.json();

            // Filtra apenas os dias que estão com status PAGO
            const diasPagos = eventos
                .filter((e: any) => e.extendedProps.status === 'PAGO')
                .map((e: any) => e.start); // A API retorna YYYY-MM-DD em 'start'

            setDiasPagosUsuarioAtual(diasPagos);

        } catch (error) {
            console.error("Erro ao buscar dias pagos:", error);
            mostrarToast("Não foi possível carregar os dias já pagos.", "erro");
        } finally {
            setLoadingDiasUser(false);
        }
    };

    // --- CARGA INICIAL ---
    useEffect(() => {
        async function loadData() {
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/financeiro/concessionarias-vt', { headers: { 'Authorization': `Bearer ${token}` } });
                const data = await res.json();
                setConcessionarias((data as any[]).filter((c: any) => c.ativo));
            } catch (err) { console.error(err); }
        }
        loadData();
    }, []);

    // --- HANDLERS DO CALENDÁRIO MESTRE ---
    const toggleDiaGlobal = (dataStr: string) => {
        setDiasGlobais(prev => {
            if (prev.includes(dataStr)) return prev.filter(d => d !== dataStr).sort();
            return [...prev, dataStr].sort();
        });
        // IMPORTANTE: Ao mudar o global, resetamos as especificidades para evitar inconsistência?
        // Ou mantemos? Vamos manter, mas o usuário precisa estar ciente.
        // Por simplificação: Resetamos as exceções para garantir que todos fiquem alinhados com o novo padrão,
        // a menos que o usuário edite novamente.
        setDiasEspecificos({});
    };

    // --- HANDLERS DO CALENDÁRIO INDIVIDUAL ---
    const toggleDiaUsuario = (usuarioId: number | string, dataStr: string) => {
        setDiasEspecificos(prev => {
            // Pega os dias atuais desse usuário (ou o global se não tiver específico)
            const diasAtuais = prev[usuarioId] || [...diasGlobais];

            let novosDias;
            if (diasAtuais.includes(dataStr)) {
                novosDias = diasAtuais.filter(d => d !== dataStr);
            } else {
                novosDias = [...diasAtuais, dataStr];
            }
            novosDias.sort();

            return { ...prev, [usuarioId]: novosDias };
        });
    };



    // --- CÁLCULOS ---
    // Calcula o total individual dinamicamente
    const getDadosUsuario = (usuarioId: number | string) => {
        const usuario = usuarios.find(u => u.id === usuarioId);
        const dias = diasEspecificos[usuarioId] || diasGlobais;
        const valorDiario = parseFloat(usuario?.valor_passagem_diaria || 0);
        return {
            id: usuarioId,
            nome: usuario?.nome || '?',
            valorDiario,
            dias,
            total: dias.length * valorDiario
        };
    };

    // Totalização
    // DADOS DA TABELA (Agora é State, para permitir edição)
    // Armazena: { id, nome, valorDiario, dias (array), total (float ou string), diasManual (bool), totalManual (bool) }
    const [dadosTabela, setDadosTabela] = useState<any[]>([]);
    // Converte para float seguro (trata string vazia como 0)
    const totalVT = dadosTabela.reduce((acc, item) => acc + (parseFloat(item.total) || 0), 0);

    // Taxa (Correção do NaN)
    const taxaPercentual = selConcessionaria ? parseFloat(String(selConcessionaria.taxa_recarga_percentual || 0)) : 0;
    const taxaCalculada = totalVT * (taxaPercentual / 100);
    const valorTaxaFinal = taxaManual !== '' ? parseFloat(taxaManual) : taxaCalculada;
    const totalBoleto = totalVT + valorTaxaFinal;

    // --- OPÇÕES DOS SELECTS ---
    const usersFiltrados = usuarios.filter(u =>
        selConcessionaria &&
        u.concessionarias_vt &&
        // Garante comparação segura mesmo se um lado for string "2" e outro número 2
        u.concessionarias_vt.some((id: any) => parseInt(String(id), 10) === parseInt(String(selConcessionaria.value), 10))
    );
    const userOptions = usersFiltrados.map(u => ({ value: u.id, label: u.nome }));
    const contaOptions = contas.map(c => ({ value: c.id, label: c.nome_conta }));
    const concessOptions = concessionarias.map(c => ({
        value: c.id,
        label: c.nome,
        taxa_recarga_percentual: c.taxa_recarga_percentual,
        id_contato_financeiro: c.id_contato_financeiro // <--- PEGA DO BANCO
    }));

    useEffect(() => {
        // Gera os dados baseados na seleção e nos calendários
        const novosDados = selFuncionarios.map(sel => {
            const usuarioId = sel.value;
            const usuario = usuarios.find(u => u.id === usuarioId);
            const dias = diasEspecificos[usuarioId] || diasGlobais;
            const valorDiario = parseFloat(usuario?.valor_passagem_diaria || 0);

            // Tenta recuperar o estado anterior deste usuário na tabela
            const estadoAnterior = dadosTabela.find(d => d.id === usuarioId);

            let total;

            // Se o usuário já editou o total manualmente, mantém o valor dele
            if (estadoAnterior && estadoAnterior.totalManual) {
                total = estadoAnterior.total;
            } else {
                // Senão, calcula (Dias * Valor)
                total = dias.length * valorDiario;
            }

            return {
                id: usuarioId,
                nome: usuario?.nome || '?',
                valorDiario,
                dias,
                total,
                totalManual: estadoAnterior?.totalManual || false
            };
        });

        // Só atualiza se houver mudança real para evitar loop infinito
        // (Uma comparação simples de JSON resolve para este caso)
        if (JSON.stringify(novosDados) !== JSON.stringify(dadosTabela)) {
            setDadosTabela(novosDados);
        }
    }, [selFuncionarios, diasGlobais, diasEspecificos]);

    const handleChangeTotal = (id: number | string, novoValor: string) => {
        setDadosTabela(prev => prev.map(item => {
            if (item.id === id) {
                return {
                    ...item,
                    total: novoValor, // Permite string temporária enquanto digita
                    totalManual: true // Marca que foi editado manualmente
                };
            }
            return item;
        }));
    };

    // --- ENVIO ---
    const handleProcessarLote = async () => {
        if (!selConcessionaria || !selConta || dadosTabela.length === 0) {
            mostrarToast('Preencha os dados e selecione empregados.', 'aviso');
            return;
        }
        if (diasGlobais.length === 0 && Object.keys(diasEspecificos).length === 0) {
            mostrarToast('Selecione ao menos um dia no calendário.', 'aviso');
            return;
        }

        const confirmado = await mostrarConfirmacao(
            `Confirma o pagamento do Lote <strong>${selConcessionaria.label}</strong>?<br><br>
             Valor VT: ${formatarMoeda(totalVT)}<br>
             Taxa: ${formatarMoeda(valorTaxaFinal)}<br>
             <strong>Total: ${formatarMoeda(totalBoleto)}</strong>`,
            { tipo: 'aviso', textoConfirmar: 'Confirmar Lote' }
        );
        if (!confirmado) return;

        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const payload = {
                id_conta_debito: selConta.value,
                id_concessionaria: selConcessionaria.value,
                // Envia o ID do contato que veio no objeto selecionado
                id_contato_concessionaria: selConcessionaria.id_contato_financeiro,
                nome_concessionaria: selConcessionaria.label,
                valor_total_vt: totalVT,
                valor_total_taxa: valorTaxaFinal,
                itens: dadosTabela.map(d => {
                    // Buscamos o usuário original para pegar o id_contato_financeiro
                    const userOriginal = usuarios.find(u => u.id === d.id);
                    return {
                        usuario_id: d.id,
                        id_contato_financeiro: userOriginal?.id_contato_financeiro,
                        nome_funcionario: d.nome,
                        dias_qtd: d.dias.length,
                        valor_total: parseFloat(d.total) || 0,
                        datas_lista: d.dias
                    };
                })
            };

            const res = await fetch('/api/pagamentos/lote-vt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(payload)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error);
            }

            mostrarToast('Lote processado com sucesso!', 'sucesso');
            // Reset parcial
            setSelFuncionarios([]);
            setDiasEspecificos({});
            setTaxaManual('');

        } catch (err) {
            mostrarToast(err instanceof Error ? err.message : 'Erro ao processar lote.', 'erro');
        } finally {
            setLoading(false);
        }
    };

    const handleVerHistorico = (uId: number | string) => {
        setUsuarioParaHistorico(uId);
        setModalHistoricoAberto(true);
    };

    return (
        <div className="cpg-card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px', borderBottom:'1px solid #e9ecef', paddingBottom:'10px'}}>
                <h2 className="cpg-section-title" style={{border:'none', margin:0, padding:0}}>Lote de Vale Transporte</h2>
                <button
                    className="cpg-btn cpg-btn-secundario"
                    onClick={() => setModalRecibosAberto(true)}
                >
                    <i className="fas fa-print"></i> Gerenciar Recibos
                </button>
            </div>

            <div className="cpg-bonus-container" style={{gridTemplateColumns: '1fr 2fr'}}>

                {/* --- COLUNA 1: CONFIGURAÇÃO --- */}
                <div>
                    <div className="cpg-form-group">
                        <label>Concessionária</label>
                        <Select
                            options={concessOptions}
                            value={selConcessionaria}
                            onChange={(val) => {
                                setSelConcessionaria(val);
                                setSelFuncionarios([]);
                                setDiasEspecificos({});
                            }}
                            placeholder="Selecione..."
                            components={{ NoOptionsMessage: CustomNoOptions }}
                        />
                    </div>

                    <div className="cpg-form-group">
                        <label>Dias de Recarga (Padrão para Todos)</label>
                        <div style={{ marginTop: '5px' }}>
                            <CPAGMultiDatePicker
                                diasSelecionados={diasGlobais}
                                onToggleDia={toggleDiaGlobal}
                            />
                        </div>
                        <small style={{display:'block', marginTop:'5px', color:'#666'}}>
                            Clique nos dias para selecionar/remover.
                        </small>
                    </div>
                </div>

                {/* --- COLUNA 2: SELEÇÃO E TABELA --- */}
                <div>
                    <div className="cpg-form-group">
                        <label>Selecionar Empregados ({selConcessionaria?.label || '...'})</label>
                        <Select
                            isMulti
                            options={userOptions}
                            value={selFuncionarios}
                            onChange={(value) => setSelFuncionarios(Array.from(value))}
                            placeholder={!selConcessionaria ? "Selecione a concessionária primeiro" : "Busque e selecione..."}
                            isDisabled={!selConcessionaria}
                            components={{ NoOptionsMessage: CustomNoOptions }}
                            closeMenuOnSelect={false}
                        />
                    </div>

                    {dadosTabela.length > 0 && (
                        <div style={{marginTop:'20px'}}>
                            <table className="cpg-tabela-detalhes">
                                <thead>
                                    <tr>
                                        <th>Funcionário</th>
                                        <th style={{textAlign:'center'}}>Valor Dia</th>
                                        <th style={{textAlign:'center'}}>Dias Selecionados</th>
                                        <th style={{textAlign:'right'}}>Total</th>
                                        <th style={{width:'50px'}}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {dadosTabela.map(item => (
                                        <tr key={item.id}>
                                            <td>{item.nome}</td>
                                            <td style={{textAlign:'center'}}>{formatarMoeda(item.valorDiario)}</td>
                                            <td style={{textAlign:'center'}}>
                                                <button
                                                    className="cpg-btn-secundario"
                                                    style={{padding:'5px 10px', fontSize:'0.9rem'}}
                                                    onClick={() => handleAbrirEdicaoUsuario(item.id)} // <--- ALTERADO AQUI
                                                >
                                                    {item.dias.length} dias <i className="fas fa-edit"></i>
                                                </button>

                                                {/* POPOVER DE EDIÇÃO INDIVIDUAL */}
                                                {modalUserAberto === item.id && (
                                                    <div style={{
                                                        position:'absolute', zIndex:100,
                                                        background:'#fff', padding:'15px',
                                                        boxShadow:'0 5px 25px rgba(0,0,0,0.3)',
                                                        borderRadius:'8px',
                                                        left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
                                                        width: '340px'
                                                    }}>
                                                        <h4 style={{margin:'0 0 15px 0', fontSize:'1rem', textAlign:'center'}}>
                                                            Ajustar: {item.nome}
                                                        </h4>

                                                        {loadingDiasUser ? (
                                                            <div className="cpg-spinner" style={{padding:'20px'}}>Carregando histórico...</div>
                                                        ) : (
                                                            <CPAGMultiDatePicker
                                                                diasSelecionados={item.dias}
                                                                diasBloqueados={diasPagosUsuarioAtual} // <--- AQUI ESTÁ O BLOQUEIO
                                                                onToggleDia={(d) => toggleDiaUsuario(item.id, d)}
                                                            />
                                                        )}

                                                        <div style={{display:'flex', justifyContent:'flex-end', marginTop:'15px'}}>
                                                            <button
                                                                className="cpg-btn cpg-btn-primario"
                                                                style={{width:'100%'}}
                                                                onClick={() => setModalUserAberto(null)}
                                                            >
                                                                Concluir
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* FIM DO MODAL HACK */}

                                                {/* BACKDROP PARA O MODAL ACIMA */}
                                                {modalUserAberto === item.id && (
                                                    <div
                                                        style={{position:'fixed', top:0, left:0, width:'100%', height:'100%', zIndex:99}}
                                                        onClick={() => setModalUserAberto(null)}
                                                    ></div>
                                                )}

                                            </td>
                                            <td style={{textAlign:'right'}}>
                                                <div style={{display:'flex', alignItems:'center', justifyContent:'flex-end', gap:'5px'}}>
                                                    <span style={{fontSize:'0.9rem', color:'#666'}}>R$</span>
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        value={item.total}
                                                        onChange={(e) => handleChangeTotal(item.id, e.target.value)}
                                                        className="cpg-input"
                                                        style={{
                                                            padding:'5px',
                                                            textAlign:'right',
                                                            width:'100px',
                                                            fontWeight:'bold',
                                                            color: 'var(--cpg-cor-despesa)',
                                                            border: item.totalManual ? '1px solid #f39c12' : '1px solid #ced4da'
                                                        }}
                                                        title={item.totalManual ? "Valor editado manualmente" : "Calculado automaticamente"}
                                                    />
                                                </div>
                                            </td>
                                            <td>
                                                <button className="cpg-btn-icon-small" title="Ver Histórico" onClick={() => handleVerHistorico(item.id)}>
                                                    <i className="fas fa-history"></i>
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>

                            {/* RODAPÉ FINANCEIRO */}
                            <div style={{
                                marginTop: '20px', background: '#f8f9fa', padding: '20px',
                                borderRadius: '8px', display: 'grid', gap: '15px',
                                gridTemplateColumns: '1fr 1fr 2fr 1fr'
                            }}>
                                <div>
                                    <label style={{fontSize:'0.8rem', color:'#666'}}>Subtotal VT</label>
                                    <div style={{fontWeight:'bold'}}>{formatarMoeda(totalVT)}</div>
                                </div>
                                <div>
                                    <label style={{fontSize:'0.8rem', color:'#666'}}>Taxa {taxaManual && '(Manual)'}</label>
                                    <input
                                        type="number" step="0.01" className="cpg-input"
                                        style={{padding:'5px', fontSize:'0.9rem'}}
                                        placeholder={formatarMoeda(taxaCalculada)}
                                        value={taxaManual}
                                        onChange={e => setTaxaManual(e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label style={{fontSize:'0.8rem', color:'#666'}}>Conta Saída</label>
                                    <Select
                                        options={contaOptions}
                                        value={selConta} onChange={setSelConta}
                                        placeholder="Selecione..."
                                        menuPlacement="top"
                                    />
                                </div>
                                <div style={{textAlign:'right'}}>
                                    <label style={{fontSize:'0.8rem', color:'#666'}}>Total</label>
                                    <div style={{fontSize:'1.3rem', fontWeight:'bold', color:'var(--cpg-cor-despesa)'}}>
                                        {formatarMoeda(totalBoleto)}
                                    </div>
                                </div>
                            </div>

                            <button
                                className="cpg-btn cpg-btn-primario"
                                style={{width:'100%', marginTop:'20px'}}
                                onClick={handleProcessarLote}
                                disabled={loading}
                            >
                                {loading ? 'Processando...' : 'Confirmar Lote'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* MODAL DE HISTÓRICO */}
            <CPAGModalHistoricoVT
                isOpen={modalHistoricoAberto}
                onClose={() => setModalHistoricoAberto(false)}
                usuarioId={usuarioParaHistorico}
            />
            {/* MODAL DE RECIBOS (NOVO) */}
            <CPAGGerenciadorRecibosVT
                isOpen={modalRecibosAberto}
                onClose={() => setModalRecibosAberto(false)}
            />
        </div>
    );
}
