import React, { useState, useEffect } from 'react';
import type { CpagUsuario } from '../utils/cpag-types';
import Select, { components } from 'react-select';
import { formatarMoeda } from '../utils/cpag-format';
import { mostrarToast, mostrarConfirmacao } from '../utils/cpag-feedback';
import UIFeedbackNotFound from './UIFeedbackNotFound';
import CPAGMultiDatePicker from './CPAGMultiDatePicker.tsx';
import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';

interface SelectOption { value: number | string; label: string; }
interface IntervaloRecibo { data_inicio: string; data_fim: string; }
interface ReciboDia { data: string; totalDia: number; valor: number; pontos: number; resgate: number; ganhoCofre: number; metaNome: string; }
type PdfComTabela = jsPDF & { lastAutoTable?: { finalY: number } };

const CustomNoOptions = (props: any) => (
    <components.NoOptionsMessage {...props}>
        <div style={{ padding: '10px' }}><UIFeedbackNotFound icon="fa-search" titulo="Sem resultados" mensagem="Nenhum registro." /></div>
    </components.NoOptionsMessage>
);

interface Props { isOpen: boolean; onClose: () => void; usuarios: CpagUsuario[]; }

export default function CPAGModalReciboComissao({ isOpen, onClose, usuarios }: Props) {
    const [selectedUser, setSelectedUser] = useState<SelectOption | null>(null);
    const [diasSelecionados, setDiasSelecionados] = useState<string[]>([]);
    const [diasBloqueados, setDiasBloqueados] = useState<string[]>([]);
    const [dadosRecibo, setDadosRecibo] = useState<ReciboDia[] | null>(null);
    const [loading, setLoading] = useState(false);

    const userOptions = usuarios.map(u => ({ value: u.id, label: u.nome }));

    // Reset ao abrir
    useEffect(() => {
        if (isOpen) {
            setSelectedUser(null);
            setDiasSelecionados([]);
            setDadosRecibo(null);
        }
    }, [isOpen]);

    // --- CORREÇÃO ITEM 1: Busca Dias Bloqueados (Ano Atual e Anterior) ---
    useEffect(() => {
        if (!selectedUser || !isOpen) { 
            setDiasBloqueados([]);
            return;
        }

        async function loadBloqueados() {
            try {
                const token = localStorage.getItem('token');
                const anoAtual = new Date().getFullYear();
                
                // Busca ano atual E ano passado para garantir a virada de ano
                const [resAtual, resAnterior] = await Promise.all([
                    fetch(`/api/pagamentos/recibos/historico-periodos?usuario_id=${selectedUser!.value}&ano=${anoAtual}`, { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch(`/api/pagamentos/recibos/historico-periodos?usuario_id=${selectedUser!.value}&ano=${anoAtual - 1}`, { headers: { 'Authorization': `Bearer ${token}` } })
                ]);

                const int1 = await resAtual.json() as IntervaloRecibo[];
                const int2 = await resAnterior.json() as IntervaloRecibo[];
                const intervalos = [...int1, ...int2];

                const diasOcupados: string[] = [];
                intervalos.forEach(intervalo => {
                    // Garante fuso horário seguro adicionando hora fixa
                    let cursor = new Date(intervalo.data_inicio.substring(0, 10) + 'T12:00:00');
                    const fim = new Date(intervalo.data_fim.substring(0, 10) + 'T12:00:00');

                    while (cursor <= fim) {
                        diasOcupados.push(cursor.toISOString().split('T')[0]);
                        cursor.setDate(cursor.getDate() + 1);
                    }
                });
                
                // Remove duplicatas (Set) e atualiza
                setDiasBloqueados([...new Set(diasOcupados)]);

            } catch (err) { console.error(err); }
        }
        loadBloqueados();
    }, [selectedUser, isOpen]); 

    // Lógica de Seleção de Semana
    const handleToggleDia = (dataStr: string) => {
        if (!selectedUser) {
            mostrarToast("Selecione um empregado primeiro.", "aviso");
            return;
        }

        // Força meio dia para evitar problemas de fuso
        const dataClicada = new Date(dataStr + 'T12:00:00');
        const diaSemana = dataClicada.getDay();
        
        const domingo = new Date(dataClicada);
        domingo.setDate(dataClicada.getDate() - diaSemana);
        
        const sabado = new Date(domingo);
        sabado.setDate(domingo.getDate() + 6);

        const semana: string[] = [];
        let cursor = new Date(domingo);
        while (cursor <= sabado) {
            semana.push(cursor.toISOString().split('T')[0]);
            cursor.setDate(cursor.getDate() + 1);
        }

        if (diasSelecionados.includes(semana[0])) {
            setDiasSelecionados([]);
            setDadosRecibo(null);
        } else {
            setDiasSelecionados(semana);
            buscarDadosRecibo(semana[0], semana[6], selectedUser!.value);
        }
    };

    const buscarDadosRecibo = async (inicio: string, fim: string, uid: number | string) => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/pagamentos/recibos/dados?usuario_id=${uid}&data_inicio=${inicio}&data_fim=${fim}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json() as ReciboDia[];
            setDadosRecibo(data);
        } catch (err) { mostrarToast("Erro ao buscar dados.", "erro"); } finally { setLoading(false); }
    };

    // --- GERAÇÃO DE PDF (CORREÇÕES 2, 3, 4, 5) ---
    const handleGerarPDF = async () => {
        if (!selectedUser || !dadosRecibo || diasSelecionados.length === 0) return;

        const confirmado = await mostrarConfirmacao(
            "Gerar o recibo e marcar este período como conferido?",
            { tipo: 'aviso', textoConfirmar: 'Gerar Recibo' }
        );
        if (!confirmado) return;

        setLoading(true);
        try {
            const doc = new jsPDF() as PdfComTabela;
            const token = localStorage.getItem('token');
            
            // CORREÇÃO ITEM 4: Força T12:00:00 para evitar voltar um dia
            const inicioStr = new Date(diasSelecionados[0] + 'T12:00:00').toLocaleDateString('pt-BR');
            const fimStr = new Date(diasSelecionados[6] + 'T12:00:00').toLocaleDateString('pt-BR');
            const emissaoStr = new Date().toLocaleDateString('pt-BR');

            // Cabeçalho
            doc.setFontSize(16);
            doc.text("CONFERÊNCIA DE PRODUÇÃO SEMANAL", 105, 20, { align: 'center' });
            
            doc.setFontSize(10);
            doc.text(`Empregado: ${selectedUser.label}`, 14, 35);
            doc.text(`Período: ${inicioStr} a ${fimStr}`, 14, 40);
            // CORREÇÃO ITEM 5: Data de Emissão
            doc.text(`Data de Emissão: ${emissaoStr}`, 14, 45); 

            // Tabela 1: Produção
            const dadosFiltrados = dadosRecibo.filter(d => d.totalDia > 0 || d.valor > 0);
            const totalValor = dadosRecibo.reduce((acc, d) => acc + d.valor, 0);

            const bodyTable1 = dadosFiltrados.map(d => {
                // Ajuste de fuso na exibição da tabela também
                const dataFmt = new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR');
                const resgateFmt = d.resgate > 0 ? `+${Math.round(d.resgate)}` : '-';
                return [
                    dataFmt,
                    Math.round(d.pontos),
                    resgateFmt,
                    Math.round(d.totalDia),
                    d.metaNome
                ];
            });

            autoTable(doc, {
                startY: 55,
                head: [['Data', 'Prod.', 'Resgate', 'Total Dia', 'Meta']],
                body: bodyTable1,
                theme: 'grid',
                foot: [['', '', '', 'VALOR TOTAL:', formatarMoeda(totalValor)]],
                headStyles: { fillColor: [41, 128, 185], halign:'center', valign:'middle' },
                columnStyles: { 0: {halign:'center'}, 1: {halign:'center'}, 2: {halign:'center'}, 3: {halign:'center', fontStyle:'bold'}, 4: {halign:'center'} },
                footStyles: { fillColor: [240, 240, 240], textColor: [0,0,0], fontStyle:'bold', halign:'right' },
                styles: { cellPadding: 3, fontSize: 10 }
            });

            let finalY = (doc.lastAutoTable?.finalY ?? 55) + 15;

            // CORREÇÃO ITEM 3: Tabela de Cofre (Auditoria)
            const movCofre = dadosRecibo.filter(d => d.ganhoCofre > 0 || d.resgate > 0);
            if (movCofre.length > 0) {
                // Verifica quebra de página
                if (finalY > 230) { doc.addPage(); finalY = 40; }

                doc.setFontSize(11);
                doc.text("Movimentações do Banco de Pontos (Cofre)", 14, finalY);
                finalY += 5;
                
                const bodyCofre = movCofre.map(d => {
                    const dataFmt = new Date(d.data + 'T12:00:00').toLocaleDateString('pt-BR');
                    let desc = '', val = '';
                    let textColor = [0,0,0]; // Preto

                    if (d.ganhoCofre > 0) { 
                        // Lógica: Se sobrou pontos, é referente à produção do dia anterior ou do próprio dia?
                        // Mantendo simples:
                        desc = 'Sobra de Produção (Crédito)'; 
                        val = `+${Math.round(d.ganhoCofre)}`;
                        textColor = [39, 174, 96]; // Verde
                    } else { 
                        desc = 'Resgate para Meta (Débito)'; 
                        val = `-${Math.round(d.resgate)}`;
                        textColor = [231, 76, 60]; // Vermelho
                    }
                    
                    return {
                        content: [dataFmt, desc, val],
                        styles: { textColor: textColor } // Aplica cor na linha (hack simples) ou coluna
                    };
                });

                const bodyCofreSimples = movCofre.map(d => {
                    // Data do registro
                    const dataRegObj = new Date(d.data + 'T12:00:00');
                    const dataFmt = dataRegObj.toLocaleDateString('pt-BR');
                    
                    if (d.ganhoCofre > 0) {
                        // Calcula a data de referência (Dia anterior ao registro)
                        const dataRefObj = new Date(dataRegObj);
                        dataRefObj.setDate(dataRefObj.getDate() - 1);
                        // Formata como DD/MM
                        const dataRefStr = dataRefObj.toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
                        
                        return [dataFmt, `Sobra de Produção (Ref. ${dataRefStr})`, `+${Math.round(d.ganhoCofre)}`];
                    }
                    
                    return [dataFmt, 'Resgate para Meta (Débito)', `-${Math.round(d.resgate)}`];
                });

                autoTable(doc, {
                    startY: finalY,
                    head: [['Data', 'Descrição', 'Pontos']],
                    body: bodyCofreSimples,
                    theme: 'striped',
                    headStyles: { fillColor: [100, 100, 100] },
                    columnStyles: { 2: {halign:'right', fontStyle:'bold'} },
                    styles: { fontSize: 9 }
                });
                finalY = (doc.lastAutoTable?.finalY ?? finalY) + 20;
            } else {
                finalY += 10;
            }

            // Assinatura
            if (finalY > 250) { doc.addPage(); finalY = 40; }
            
            doc.setLineWidth(0.5);
            doc.line(60, finalY, 150, finalY);
            doc.setFontSize(10);
            doc.text("Assinatura do Empregado", 105, finalY + 5, { align: 'center' });
            
            // CORREÇÃO ITEM 2: Texto Legal
            doc.setFontSize(8);
            doc.text("Declaro que conferi os dados acima e estou de acordo com TODOS os valores apresentados.", 105, finalY + 15, { align: 'center' });

            doc.save(`Recibo_Comissao_${selectedUser.label}_${inicioStr.replace(/\//g,'-')}.pdf`);

            // Verifica se é uma reimpressão (se o primeiro dia da semana já estava bloqueado)
            const ehReimpressao = diasBloqueados.includes(diasSelecionados[0]);

            if (!ehReimpressao) {
                // SÓ REGISTRA SE FOR NOVO
                await fetch('/api/pagamentos/recibos/registrar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ 
                        usuario_id: selectedUser.value, 
                        data_inicio: diasSelecionados[0], 
                        data_fim: diasSelecionados[6] 
                    })
                });
                
                // Atualiza visualmente os bloqueados
                setDiasBloqueados(prev => [...prev, ...diasSelecionados]);
                mostrarToast('Recibo gerado e registrado!', 'sucesso');
            } else {
                mostrarToast('Recibo reimpresso com sucesso (Registro mantido).', 'info');
            }

            // Limpeza padrão
            setDiasSelecionados([]);
            setDadosRecibo(null);

        } catch (err) { mostrarToast("Erro ao processar.", "erro"); } finally { setLoading(false); }
    };

    if (!isOpen) return null;

    return (
        <div className="cpg-modal-overlay">
            <div className="cpg-modal-content" style={{maxWidth:'950px', height:'90vh'}}>
                <div className="cpg-modal-header">
                    <h2>Gerador de Recibos Semanais</h2>
                    <button className="cpg-modal-close-btn" onClick={onClose}>×</button>
                </div>
                
                <div className="cpg-modal-body" style={{display:'grid', gridTemplateColumns:'1fr 1.5fr', gap:'20px'}}>
                    
                    {/* ESQUERDA */}
                    <div>
                        <div className="cpg-form-group">
                            <label>Empregado</label>
                            <Select
                                options={userOptions}
                                value={selectedUser}
                                onChange={(val) => { setSelectedUser(val); setDiasSelecionados([]); }}
                                placeholder="Buscar..."
                                components={{ NoOptionsMessage: CustomNoOptions }}
                            />
                        </div>
                        <div className="cpg-form-group">
                            <label>Selecionar Semana (Clique num dia)</label>
                            <div style={{marginTop:'5px', display:'flex', justifyContent:'center'}}>
                                <CPAGMultiDatePicker
                                    diasSelecionados={diasSelecionados}
                                    diasBloqueados={diasBloqueados}
                                    onToggleDia={handleToggleDia}
                                    legendaBloqueado="Recibo já gerado"
                                    legendaSelecionado="Semana Selecionada"
                                />
                            </div>
                        </div>
                    </div>

                    {/* DIREITA (Preview) */}
                    <div style={{background:'#f8f9fa', padding:'20px', borderRadius:'8px', overflowY:'auto'}}>
                        {!selectedUser ? <p style={{textAlign:'center', color:'#999', marginTop:'50px'}}>Selecione um empregado.</p> : 
                         diasSelecionados.length === 0 ? <p style={{textAlign:'center', color:'#999', marginTop:'50px'}}>Selecione uma semana.</p> :
                         loading ? <div className="cpg-spinner">Calculando...</div> : (
                            <div style={{width:'100%', textAlign:'center'}}>
                                <h3 style={{color:'#2c3e50', marginBottom:'5px'}}>Resumo da Semana</h3>
                                <p style={{marginBottom:'20px', color:'#7f8c8d'}}>
                                    {new Date(diasSelecionados[0] + 'T12:00:00').toLocaleDateString('pt-BR')} até {new Date(diasSelecionados[6] + 'T12:00:00').toLocaleDateString('pt-BR')}
                                </p>
                                
                                <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px', marginBottom:'20px'}}>
                                    <div style={{background:'#fff', padding:'15px', borderRadius:'8px', border:'1px solid #e9ecef'}}>
                                        <div style={{fontSize:'0.8rem', color:'#666'}}>Dias Produtivos</div>
                                        <div style={{fontSize:'1.5rem', fontWeight:'bold'}}>
                                            {dadosRecibo?.filter(d => d.totalDia > 0).length || 0}
                                        </div>
                                    </div>
                                    <div style={{background:'#fff', padding:'15px', borderRadius:'8px', border:'1px solid #e9ecef'}}>
                                        <div style={{fontSize:'0.8rem', color:'#666'}}>Valor Total</div>
                                        <div style={{fontSize:'1.5rem', fontWeight:'bold', color:'var(--cpg-cor-receita)'}}>
                                            {formatarMoeda(dadosRecibo?.reduce((acc, d) => acc + d.valor, 0) || 0)}
                                        </div>
                                    </div>
                                </div>

                                <button className="cpg-btn cpg-btn-primario" style={{width:'100%', height:'50px'}} onClick={handleGerarPDF}>
                                    Gerar e Salvar Recibo
                                </button>
                            </div>
                        )}
                    </div>

                </div>
            </div>
        </div>
    );
}
