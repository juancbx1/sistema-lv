import React, { useState, useRef, useEffect } from 'react';
import Select from 'react-select';
import UIBloqueio from './UIBloqueio.jsx';
import { formatarDataParaInput, formatarHora, formatarDataDisplay } from '/js/utils/formataDtHr.js';
import { mostrarMensagem } from '/js/utils/popups.js';
import { fetchAPI } from '/js/utils/api-utils.js';

const TIPOS_DISPONIVEIS = [
    { id: 'administrador', label: 'Administrador' },
    { id: 'socio', label: 'Sócio' },
    { id: 'ex_socio', label: 'Ex-sócio' },
    { id: 'supervisor', label: 'Supervisor' },
    { id: 'lider_setor', label: 'Líder de Setor' },
    { id: 'costureira', label: 'Costureira' },
    { id: 'tiktik', label: 'TikTik' },
    { id: 'cortador', label: 'Cortador' },
    { id: 'prestador_externo', label: 'Prestador Externo' },
];

const DIAS = [['0','Dom'],['1','Seg'],['2','Ter'],['3','Qua'],['4','Qui'],['5','Sex'],['6','Sáb']];
const PRODUTIVOS = ['costureira', 'tiktik', 'cortador', 'supervisor', 'lider_setor'];

function calcularDias(inicio, fim) {
    if (!inicio || !fim) return 0;
    return Math.round((new Date(fim) - new Date(inicio)) / (1000 * 60 * 60 * 24)) + 1;
}

export default function UCDrawerEdicao({ usuario, onClose, aoSalvar, aoAtualizarLista, concessionarias }) {
    const [salvando, setSalvando] = useState(false);
    const [uploadandoFoto, setUploadandoFoto] = useState(false);
    const [visible, setVisible] = useState(false);
    const inputFotoRef = useRef(null);

    // Categoria original do usuário (não muda conforme o form)
    const tiposOriginais = usuario.tipos || [];
    const categoriaOriginal = (() => {
        if (tiposOriginais.includes('prestador_externo')) return 'prestador_externo';
        if (tiposOriginais.includes('ex_socio')) return 'ex_socio';
        if (usuario.data_demissao && tiposOriginais.includes('socio')) return 'ex_socio';
        if (usuario.data_demissao) return 'ex_empregado';
        if (tiposOriginais.includes('socio')) return 'socio';
        if (tiposOriginais.some(t => PRODUTIVOS.includes(t))) return 'empregado';
        return 'administrador';
    })();
    const mostrarFeriasVinculo = categoriaOriginal === 'empregado';

    // --- Form principal ---
    const [formData, setFormData] = useState({
        id: usuario.id,
        nome_completo: usuario.nome_completo || '',
        nomeUsuario: usuario.nome_usuario || '',
        email: usuario.email || '',
        data_admissao: formatarDataParaInput(usuario.data_admissao),
        data_demissao: formatarDataParaInput(usuario.data_demissao),
        tipos: usuario.tipos || [],
        nivel: usuario.nivel || '',
        horario_entrada_1: formatarHora(usuario.horario_entrada_1) || '07:30',
        horario_saida_1: formatarHora(usuario.horario_saida_1) || '11:30',
        horario_entrada_2: formatarHora(usuario.horario_entrada_2) || '12:30',
        horario_saida_2: formatarHora(usuario.horario_saida_2) || '17:18',
        horario_entrada_3: formatarHora(usuario.horario_entrada_3) || '',
        horario_saida_3: formatarHora(usuario.horario_saida_3) || '',
        dias_trabalho: usuario.dias_trabalho || { '1': true, '2': true, '3': true, '4': true, '5': true },
        salario_fixo: usuario.salario_fixo || 0,
        valor_passagem_diaria: usuario.valor_passagem_diaria || 0,
        elegivel_pagamento: usuario.elegivel_pagamento || false,
        desconto_inss_percentual: usuario.desconto_inss_percentual || 9.0,
        desconto_vt_percentual: usuario.desconto_vt_percentual || 6.0,
        concessionaria_ids: usuario.concessionarias_vt || [],
        foto_oficial: usuario.foto_oficial || '',
    });

    // --- Férias ---
    const [historico, setHistorico] = useState([]);
    const [loadingFerias, setLoadingFerias] = useState(false);
    const [salvandoFerias, setSalvandoFerias] = useState(false);
    const [dataInicioFerias, setDataInicioFerias] = useState('');
    const [dataFimFerias, setDataFimFerias] = useState('');

    // --- Vínculo financeiro ---
    const [vinculoAtual, setVinculoAtual] = useState({
        id: usuario.id_contato_financeiro,
        nome: usuario.nome_contato_financeiro,
    });
    const [termoVinculo, setTermoVinculo] = useState('');
    const [resultadosVinculo, setResultadosVinculo] = useState([]);
    const [loadingVinculo, setLoadingVinculo] = useState(false);
    const [vinculando, setVinculando] = useState(false);

    useEffect(() => {
        requestAnimationFrame(() => setVisible(true));
        const handleEsc = (e) => { if (e.key === 'Escape') handleClose(); };
        window.addEventListener('keydown', handleEsc);
        if (mostrarFeriasVinculo) carregarHistoricoFerias();
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    const handleClose = () => {
        setVisible(false);
        setTimeout(onClose, 280);
    };

    // --- Tipo derivados do form (para mostrar/ocultar seções) ---
    const tipos = formData.tipos;
    const ehSocio = tipos.includes('socio');
    const ehExterno = tipos.includes('prestador_externo');
    const temProdutivo = tipos.some(t => PRODUTIVOS.includes(t));
    const mostrarVinculo = !ehSocio && !ehExterno;
    const mostrarJornada = temProdutivo && !ehSocio && !ehExterno;
    const mostrarFinanceiro = temProdutivo && !ehSocio && !ehExterno;

    const concessOptions = (concessionarias || []).map(c => ({ value: c.id, label: c.nome }));
    const concessValue = concessOptions.filter(opt =>
        formData.concessionaria_ids.some(id => parseInt(id) === parseInt(opt.value))
    );

    // --- Handlers do form ---
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleTipoChange = (tipoId) => {
        setFormData(prev => {
            if (prev.tipos.includes(tipoId)) {
                return { ...prev, tipos: prev.tipos.filter(t => t !== tipoId) };
            }
            // socio e ex_socio são mutuamente exclusivos
            let novosTipos = [...prev.tipos, tipoId];
            if (tipoId === 'socio') novosTipos = novosTipos.filter(t => t !== 'ex_socio');
            if (tipoId === 'ex_socio') novosTipos = novosTipos.filter(t => t !== 'socio');
            return { ...prev, tipos: novosTipos };
        });
    };

    const handleDiaChange = (dia) => {
        setFormData(prev => ({
            ...prev,
            dias_trabalho: { ...prev.dias_trabalho, [dia]: !prev.dias_trabalho[dia] },
        }));
    };

    const handleUploadFoto = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        setUploadandoFoto(true);
        try {
            const token = localStorage.getItem('token');
            const body = new FormData();
            body.append('foto', file);
            const res = await fetch(`/api/usuarios/${usuario.id}/foto-oficial`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` },
                body,
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Falha no upload');
            setFormData(prev => ({ ...prev, foto_oficial: data.url }));
            mostrarMensagem('Foto atualizada!', 'sucesso');
        } catch (err) {
            mostrarMensagem(`Erro: ${err.message}`, 'erro');
        } finally {
            setUploadandoFoto(false);
            e.target.value = '';
        }
    };

    const handleSalvar = async () => {
        setSalvando(true);
        try {
            const payload = {
                ...formData,
                nivel: formData.nivel ? parseInt(formData.nivel) : null,
                salario_fixo: parseFloat(formData.salario_fixo),
                valor_passagem_diaria: parseFloat(formData.valor_passagem_diaria),
                data_admissao: formData.data_admissao || null,
                data_demissao: formData.data_demissao || null,
                horario_entrada_3: formData.horario_entrada_3 || null,
                horario_saida_3: formData.horario_saida_3 || null,
            };
            await fetchAPI('/api/usuarios', { method: 'PUT', body: JSON.stringify(payload) });
            mostrarMensagem('Usuário atualizado com sucesso!', 'sucesso');
            aoSalvar();
        } catch (error) {
            mostrarMensagem(`Erro ao salvar: ${error.message}`, 'erro');
        } finally {
            setSalvando(false);
        }
    };

    // --- Handlers de Férias ---
    const carregarHistoricoFerias = async () => {
        try {
            setLoadingFerias(true);
            const dados = await fetchAPI(`/api/usuarios/${usuario.id}/ferias`);
            setHistorico(dados);
        } catch { } finally {
            setLoadingFerias(false);
        }
    };

    const handleRegistrarFerias = async () => {
        if (!dataInicioFerias || !dataFimFerias) {
            mostrarMensagem('Preencha as datas de início e fim.', 'aviso');
            return;
        }
        setSalvandoFerias(true);
        try {
            await fetchAPI(`/api/usuarios/${usuario.id}/ferias`, {
                method: 'POST',
                body: JSON.stringify({ data_inicio: dataInicioFerias, data_fim: dataFimFerias, observacoes: '' }),
            });
            mostrarMensagem('Férias registradas!', 'sucesso');
            setDataInicioFerias('');
            setDataFimFerias('');
            await carregarHistoricoFerias();
            aoAtualizarLista();
        } catch (error) {
            mostrarMensagem(`Erro: ${error.message}`, 'erro');
        } finally {
            setSalvandoFerias(false);
        }
    };

    // --- Handlers de Vínculo ---
    const handleBuscarVinculo = async (valor) => {
        setTermoVinculo(valor);
        if (valor.length < 3) { setResultadosVinculo([]); return; }
        try {
            setLoadingVinculo(true);
            const dados = await fetchAPI(`/api/usuarios/buscar-contatos-empregado?q=${encodeURIComponent(valor)}`);
            setResultadosVinculo(dados || []);
        } catch { } finally {
            setLoadingVinculo(false);
        }
    };

    const handleVincular = async (contato) => {
        setVinculando(true);
        try {
            await fetchAPI('/api/usuarios', {
                method: 'PUT',
                body: JSON.stringify({ id: usuario.id, id_contato_financeiro: contato.id }),
            });
            setVinculoAtual({ id: contato.id, nome: contato.nome });
            setTermoVinculo('');
            setResultadosVinculo([]);
            mostrarMensagem('Vínculo financeiro atualizado!', 'sucesso');
            aoAtualizarLista();
        } catch (error) {
            mostrarMensagem(`Erro: ${error.message}`, 'erro');
        } finally {
            setVinculando(false);
        }
    };

    return (
        <div
            className={`uc-drawer-overlay${visible ? ' uc-drawer-overlay--visivel' : ''}`}
            onClick={handleClose}
        >
            <aside
                className={`uc-drawer${visible ? ' uc-drawer--visivel' : ''}`}
                onClick={e => e.stopPropagation()}
            >
                <div className="uc-drawer-header">
                    <div>
                        <h2 className="uc-drawer-titulo">Editar usuário</h2>
                        <p className="uc-drawer-subtitulo">{usuario.nome}</p>
                    </div>
                    <button className="uc-drawer-fechar" onClick={handleClose} aria-label="Fechar">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="uc-drawer-corpo">

                    {/* Foto */}
                    <div className="uc-drawer-secao">
                        <div className="uc-foto-container">
                            <div
                                className="uc-foto-preview"
                                style={formData.foto_oficial ? { backgroundImage: `url('${formData.foto_oficial}')` } : {}}
                            >
                                {!formData.foto_oficial && <i className="fas fa-user"></i>}
                            </div>
                            <div className="uc-foto-acoes">
                                <button
                                    type="button"
                                    className="gs-btn gs-btn-secundario"
                                    onClick={() => inputFotoRef.current?.click()}
                                    disabled={uploadandoFoto}
                                >
                                    <i className={`fas ${uploadandoFoto ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i>
                                    {uploadandoFoto ? ' Enviando...' : ' Alterar foto'}
                                </button>
                                {formData.foto_oficial && (
                                    <button
                                        type="button"
                                        className="gs-btn gs-btn-perigo"
                                        onClick={() => setFormData(prev => ({ ...prev, foto_oficial: '' }))}
                                        disabled={uploadandoFoto}
                                    >
                                        <i className="fas fa-trash"></i>
                                    </button>
                                )}
                                <input ref={inputFotoRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleUploadFoto} />
                            </div>
                        </div>
                    </div>

                    {/* Dados pessoais */}
                    <div className="uc-drawer-secao">
                        <h3 className="uc-drawer-secao-titulo">Dados pessoais</h3>
                        <div className="uc-form-grid">
                            <div className="uc-form-campo uc-form-campo--full">
                                <label>Nome completo</label>
                                <input type="text" name="nome_completo" className="gs-input" value={formData.nome_completo} onChange={handleChange} />
                            </div>
                            <div className="uc-form-campo">
                                <label>Usuário</label>
                                <input type="text" name="nomeUsuario" className="gs-input" value={formData.nomeUsuario} onChange={handleChange} />
                            </div>
                            <div className="uc-form-campo">
                                <label>Email</label>
                                <input type="email" name="email" className="gs-input" value={formData.email} onChange={handleChange} />
                            </div>
                        </div>
                    </div>

                    {/* Tipos */}
                    <div className="uc-drawer-secao">
                        <h3 className="uc-drawer-secao-titulo">Tipos de acesso</h3>
                        <div className="uc-tipos-chips">
                            {TIPOS_DISPONIVEIS.map(tipo => (
                                <button
                                    key={tipo.id}
                                    type="button"
                                    className={`uc-tipo-chip${formData.tipos.includes(tipo.id) ? ' uc-tipo-chip--ativo' : ''}`}
                                    onClick={() => handleTipoChange(tipo.id)}
                                >
                                    {tipo.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Vínculo (admissão/demissão) */}
                    {mostrarVinculo && (
                        <div className="uc-drawer-secao">
                            <h3 className="uc-drawer-secao-titulo">Vínculo</h3>
                            <div className="uc-form-grid">
                                <div className="uc-form-campo">
                                    <label>Admissão</label>
                                    <input type="date" name="data_admissao" className="gs-input" value={formData.data_admissao} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>Demissão</label>
                                    <input type="date" name="data_demissao" className="gs-input" value={formData.data_demissao} onChange={handleChange} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Nível */}
                    {mostrarFinanceiro && (
                        <div className="uc-drawer-secao">
                            <h3 className="uc-drawer-secao-titulo">Nível</h3>
                            <select name="nivel" className="gs-input" value={formData.nivel} onChange={handleChange} style={{ width: '100%' }}>
                                <option value="">Sem nível</option>
                                <option value="1">Nível 1</option>
                                <option value="2">Nível 2</option>
                                <option value="3">Nível 3</option>
                                <option value="4">Nível 4</option>
                            </select>
                        </div>
                    )}

                    {/* Jornada */}
                    {mostrarJornada && (
                        <div className="uc-drawer-secao">
                            <h3 className="uc-drawer-secao-titulo">Jornada de trabalho</h3>
                            <div className="uc-dias-semana">
                                {DIAS.map(([dia, label]) => (
                                    <button
                                        key={dia}
                                        type="button"
                                        className={`uc-dia-btn${formData.dias_trabalho[dia] ? ' uc-dia-btn--ativo' : ''}`}
                                        onClick={() => handleDiaChange(dia)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                            <div className="uc-form-grid">
                                {[
                                    ['entrada_1', 'Entrada 1'],
                                    ['saida_1', 'Saída 1'],
                                    ['entrada_2', 'Entrada 2'],
                                    ['saida_2', 'Saída 2'],
                                    ['entrada_3', 'Entrada 3'],
                                    ['saida_3', 'Saída 3'],
                                ].map(([key, label]) => (
                                    <div key={key} className="uc-form-campo">
                                        <label>{label}</label>
                                        <input
                                            type="time"
                                            name={`horario_${key}`}
                                            className="gs-input"
                                            value={formData[`horario_${key}`]}
                                            onChange={handleChange}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Financeiro */}
                    {mostrarFinanceiro && (
                        <div className="uc-drawer-secao">
                            <h3 className="uc-drawer-secao-titulo">Dados financeiros</h3>
                            <div className="uc-form-grid">
                                <div className="uc-form-campo">
                                    <label>Salário fixo (R$)</label>
                                    <input type="number" name="salario_fixo" className="gs-input" step="0.01" value={formData.salario_fixo} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>Passagem/dia (R$)</label>
                                    <input type="number" name="valor_passagem_diaria" className="gs-input" step="0.01" value={formData.valor_passagem_diaria} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>% Desc. INSS</label>
                                    <input type="number" name="desconto_inss_percentual" className="gs-input" step="0.1" value={formData.desconto_inss_percentual} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>% Desc. VT</label>
                                    <input type="number" name="desconto_vt_percentual" className="gs-input" step="0.1" value={formData.desconto_vt_percentual} onChange={handleChange} />
                                </div>
                                <div className="uc-form-campo uc-form-campo--full">
                                    <label>Concessionárias VT</label>
                                    <Select
                                        isMulti
                                        options={concessOptions}
                                        value={concessValue}
                                        onChange={(opts) => setFormData(prev => ({ ...prev, concessionaria_ids: opts.map(o => o.value) }))}
                                        placeholder="Selecione..."
                                    />
                                </div>
                                <div className="uc-form-campo uc-form-campo--full">
                                    <label className="uc-checkbox-label">
                                        <input type="checkbox" name="elegivel_pagamento" checked={formData.elegivel_pagamento} onChange={handleChange} />
                                        Elegível para pagamentos
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Férias (empregados ativos) */}
                    {mostrarFeriasVinculo && (
                        <div className="uc-drawer-secao uc-drawer-secao--acao">
                            <h3 className="uc-drawer-secao-titulo">
                                <i className="fas fa-plane-departure"></i> Férias
                            </h3>
                            <div className="uc-form-grid" style={{ marginBottom: 10 }}>
                                <div className="uc-form-campo">
                                    <label>Início</label>
                                    <input type="date" className="gs-input" value={dataInicioFerias} onChange={e => setDataInicioFerias(e.target.value)} />
                                </div>
                                <div className="uc-form-campo">
                                    <label>Fim</label>
                                    <input type="date" className="gs-input" value={dataFimFerias} onChange={e => setDataFimFerias(e.target.value)} />
                                </div>
                            </div>
                            <UIBloqueio permissao="adicionar-ferias">
                                <button className="gs-btn gs-btn-secundario" onClick={handleRegistrarFerias} disabled={salvandoFerias} style={{ width: '100%' }}>
                                    {salvandoFerias ? 'Registrando...' : 'Registrar período'}
                                </button>
                            </UIBloqueio>
                            {loadingFerias ? (
                                <p className="uc-drawer-mini-msg">Carregando histórico...</p>
                            ) : historico.length > 0 ? (
                                <ul className="uc-ferias-lista" style={{ marginTop: 10 }}>
                                    {historico.map(item => {
                                        const dias = calcularDias(item.data_inicio, item.data_fim);
                                        return (
                                            <li key={item.id} className="uc-ferias-item">
                                                <i className="fas fa-plane-departure"></i>
                                                <span>{formatarDataDisplay(item.data_inicio)} → {formatarDataDisplay(item.data_fim)}</span>
                                                <span className="uc-ferias-dias">{dias}d</span>
                                            </li>
                                        );
                                    })}
                                </ul>
                            ) : (
                                <p className="uc-drawer-mini-msg">Sem registros de férias.</p>
                            )}
                        </div>
                    )}

                    {/* Vínculo financeiro (empregados ativos) */}
                    {mostrarFeriasVinculo && (
                        <div className="uc-drawer-secao uc-drawer-secao--acao">
                            <h3 className="uc-drawer-secao-titulo">
                                <i className="fas fa-link"></i> Vínculo financeiro
                            </h3>
                            {vinculoAtual.id ? (
                                <div className="uc-vinculo-atual" style={{ marginBottom: 10 }}>
                                    <i className="fas fa-check-circle"></i>
                                    Vinculado a: <strong>{vinculoAtual.nome || `ID ${vinculoAtual.id}`}</strong>
                                </div>
                            ) : (
                                <p className="uc-drawer-mini-msg" style={{ marginBottom: 8 }}>
                                    <i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }}></i> Não vinculado financeiramente
                                </p>
                            )}
                            <div className="uc-busca-wrapper">
                                <i className="fas fa-search uc-busca-icone"></i>
                                <input
                                    type="text"
                                    className="gs-input uc-busca-input"
                                    placeholder="Buscar por nome (mín. 3 letras)..."
                                    value={termoVinculo}
                                    onChange={e => handleBuscarVinculo(e.target.value)}
                                />
                            </div>
                            {(loadingVinculo || resultadosVinculo.length > 0) && (
                                <div className="uc-resultados-lista">
                                    {loadingVinculo && <p className="uc-sem-resultados">Buscando...</p>}
                                    {resultadosVinculo.map(contato => (
                                        <div key={contato.id} className="uc-resultado-item">
                                            <span>{contato.nome}</span>
                                            <button
                                                className="gs-btn gs-btn-primario gs-btn-pequeno"
                                                onClick={() => handleVincular(contato)}
                                                disabled={vinculando}
                                            >
                                                {vinculando ? '...' : 'Vincular'}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                </div>

                <div className="uc-drawer-footer">
                    <button className="gs-btn gs-btn-secundario" onClick={handleClose} disabled={salvando}>
                        Cancelar
                    </button>
                    <button className="gs-btn gs-btn-primario" onClick={handleSalvar} disabled={salvando}>
                        {salvando
                            ? <><div className="spinner-btn-interno"></div> Salvando...</>
                            : 'Salvar alterações'
                        }
                    </button>
                </div>
            </aside>
        </div>
    );
}
