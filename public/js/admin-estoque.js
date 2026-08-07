// public/js/admin-estoque.js
import { verificarAutenticacao } from '/js/utils/auth.js';
import { obterProdutos, invalidateCache } from '/js/utils/storage.js';
import { mostrarMensagem, mostrarConfirmacao } from '/js/utils/popups.js';
import { adicionarBotaoFechar } from '/js/utils/botoes-fechar.js';
import { htmlUIFeedbackNotFound } from './utils/ui-feedback.js';
import { htmlUICarregando } from './utils/ui-carregando.js';
import { removerCarregamentoInicial } from './utils/ui-carregando.js';

// --- Variáveis Globais ---
let permissoesGlobaisEstoque = [];
let usuarioLogadoEstoque = null;
let itemEstoqueSelecionado = null; // << NOVO: Variável unificada para o item em edição/detalhe
let niveisEstoqueAlertaCache = [];
let produtoSelecionadoParaConfigNiveis = null;
let editandoNivelId = null;
let currentPageEstoqueTabela = 1;
const itemsPerPageEstoqueTabela = 6;
let saldosEstoqueGlobaisCompletos = [];
let filtroAlertaAtivo = null;
let todosOsProdutosCadastrados = [];
let todosProdutosParaConfigNiveis = [];
let historicoGeralEstoquePage = 1;


let modalNiveisElement; 
let modalNiveisTituloElement;
let formModalNiveisElement;
let selectProdutoNiveisElement;
let inputNivelBaixoElement;
let inputNivelUrgenteElement;
let niveisValidationMessageElement;

// NOVO: Variáveis para o modal de histórico
let modalHistoricoElement;

let currentPageHistorico = 1;
const itemsPerPageHistorico = 6; 


// --- VARIÁVEIS PARA O MÓDULO DE SEPARAÇÃO ---
let itensEmSeparacao = new Map(); // Usaremos um Map para gerenciar os itens no "carrinho"
let produtoEmDetalheSeparacao = null;

// --- VARIÁVEIS PARA O MÓDULO DE FILA DE PRODUCAO ---
let promessasDeProducaoCache = [];

// --- VARIÁVEIS PARA O MÓDULO DE INVENTÁRIO ---
let sessaoInventarioAtiva = null; // Guarda os dados da sessão de inventário em andamento
let limparListenerRodape = null; // <<< NOVA VARIÁVEL GLOBAL


function debounce(func, wait) { 
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// Função para gerar texto de plural de forma inteligente
function getLabelFiltro(chave) {
    if (chave.toLowerCase().endsWith('r')) {
        return `Todos(as) ${chave}es`; // Ex: Cor -> Cores
    }
    if (chave.toLowerCase().endsWith('o')) {
        return `Todos os ${chave}s`; // Ex: Tamanho -> Tamanhos
    }
    return `Todos(as) ${chave}s`; // Padrão
}

// --- FUNÇÃO PARA CHAMADAS À API (Sem alterações) ---
async function fetchEstoqueAPI(endpoint, options = {}) {
    const token = localStorage.getItem('token');
    if (!token) {
        mostrarMensagem('Erro de autenticação. Faça login novamente.', 'erro');
        window.location.href = '/index.html';
        throw new Error('Token não encontrado');
    }

    const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...options.headers,
    };

    let url = `/api${endpoint}`;
    if ((!options.method || options.method.toUpperCase() === 'GET') && !url.includes('?')) {
        url += `?_=${Date.now()}`;
    } else if ((!options.method || options.method.toUpperCase() === 'GET') && url.includes('?')) {
        url += `&_=${Date.now()}`;
    }

    try {
        const response = await fetch(url, { ...options, headers });
        if (!response.ok) {
            let errorData = { error: `Erro ${response.status} - ${response.statusText}` };
            try {
                const jsonError = await response.json();
                errorData = jsonError || errorData;
            } catch (e) { /* Ignora */ }
            
            console.error(`[fetchEstoqueAPI] Erro ${response.status} em ${endpoint}:`, errorData);

            if (response.status === 401 || (errorData.error || '').toLowerCase().includes('token')) {
                localStorage.removeItem('token');
                mostrarMensagem('Sessão expirada ou inválida. Faça login novamente.', 'erro');
                window.location.href = '/index.html';
            }
            
            const err = new Error(errorData.error || `Erro ${response.status}`);
            err.status = response.status;
            err.data = errorData;
            throw err;
        }
        if (response.status === 204 || options.method === 'DELETE') {
            return { success: true };
        }
        return await response.json();
    } catch (error) {
        console.error(`[fetchEstoqueAPI] Falha ao acessar ${url}:`, error);
        throw error; 
    }
}

async function forcarAtualizacaoEstoque() {
    const btn = document.getElementById('btnAtualizarEstoque');
    if (!btn) return;

    // Desabilita o botão e mostra feedback de carregamento
    btn.disabled = true;
    const span = btn.querySelector('span');
    const originalText = span ? span.textContent : '';
    if(span) span.textContent = 'Atualizando...';

    console.log('[forcarAtualizacaoEstoque] Forçando atualização do estoque...');

    try {
        // Limpa os caches locais para forçar uma busca na API
        saldosEstoqueGlobaisCompletos = [];
        niveisEstoqueAlertaCache = [];
        await invalidateCache('produtos'); // Invalida o cache de produtos

        // Reseta filtros e paginação para uma visualização limpa
        filtroAlertaAtivo = null;
        document.querySelectorAll('.filtro-dinamico-estoque').forEach(s => s.value = '');
        const searchInput = document.getElementById('searchEstoque');
        if (searchInput) searchInput.value = '';
        currentPageEstoqueTabela = 1;

        // Esconde o header de filtro ativo, se estiver visível
        const filtroHeader = document.getElementById('filtroAtivoHeader');
        if(filtroHeader) filtroHeader.style.display = 'none';
        document.querySelectorAll('.es-alerta-card').forEach(c => c.classList.remove('filtro-ativo'));
        
        // Chama a função principal de carregamento da tabela
        await carregarTabelaEstoque();

        mostrarMensagem('Lista de estoque atualizada com sucesso!', 'sucesso', 2500);

    } catch (error) {
        console.error('[forcarAtualizacaoEstoque] Erro ao atualizar estoque:', error);
        mostrarMensagem('Falha ao atualizar a lista de estoque.', 'erro');
    } finally {
        // Reabilita o botão e restaura o texto
        if(span) span.textContent = originalText;
        btn.disabled = false;
        console.log('[forcarAtualizacaoEstoque] Atualização concluída.');
    }
}

// --- LÓGICA DE NÍVEIS DE ALERTA (Sem alterações) ---
async function abrirModalConfigurarNiveis() {
    console.log(`%c[ABRINDO MODAL] - 'Configurar Níveis' foi chamada.`, 'color: #27ae60; font-weight: bold;');
    
    if (!permissoesGlobaisEstoque.includes('gerenciar-niveis-alerta-estoque')) {
        mostrarMensagem('Você não tem permissão para configurar níveis de estoque.', 'aviso');
        return;
    }

    // Reseta o estado do modal antes de abrir
    const tbody = document.getElementById('tbodyConfigNiveis');
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="5">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm' })}</td></tr>`;
    document.getElementById('buscaProdutoNiveisModal').value = '';
    
    // Mostra o modal
    modalNiveisElement.style.display = 'flex';
    adicionarBotaoFechar(modalNiveisElement, fecharModalNiveis);


    try {
        // A lógica de fetch e renderização permanece a mesma
        const [todosProdutos, niveisSalvos] = await Promise.all([
            obterProdutos(),
            fetchEstoqueAPI('/niveis-estoque')
        ]);
        niveisEstoqueAlertaCache = niveisSalvos || [];
        todosProdutosParaConfigNiveis = [];
        todosProdutos.forEach(p => {
            if (p.grade && p.grade.length > 0) {
                p.grade.forEach(g => {
                    const nomeVar = g.variacao || 'Padrão';
                    const skuVariacao = g.sku || `${p.sku || p.nome.toUpperCase().replace(/\W/g, '')}-${nomeVar.replace(/\W/g, '')}`;
                    todosProdutosParaConfigNiveis.push({ produto_ref_id: skuVariacao, nome_completo: `${p.nome} ${nomeVar !== 'Padrão' ? `(${nomeVar})` : ''}` });
                });
            } else {
                 const skuBase = p.sku || p.nome.toUpperCase().replace(/\W/g, '');
                 todosProdutosParaConfigNiveis.push({ produto_ref_id: skuBase, nome_completo: `${p.nome} (Padrão)` });
            }
        });
        todosProdutosParaConfigNiveis.sort((a,b) => a.nome_completo.localeCompare(b.nome_completo));
        renderizarTabelaConfigNiveis(todosProdutosParaConfigNiveis);
    } catch (error) {
        mostrarMensagem("Erro ao carregar dados para configuração de níveis.", "erro");
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;">Erro ao carregar.</td></tr>`;
    }
}

function renderizarTabelaConfigNiveis(itensParaRenderizar) {
    const tbody = document.getElementById('tbodyConfigNiveis');
    if (!tbody) return;
    tbody.innerHTML = ''; 

    if (!itensParaRenderizar || itensParaRenderizar.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5">${htmlUIFeedbackNotFound({
            icon: 'fa-sliders',
            titulo: 'Nenhum produto para configurar',
            mensagem: 'Não há produtos ou variações disponíveis para configurar.',
        })}</td></tr>`;
        return;
    }

    itensParaRenderizar.forEach(item => {
        const configExistente = niveisEstoqueAlertaCache.find(n => n.produto_ref_id === item.produto_ref_id);
        const tr = tbody.insertRow();
        tr.dataset.produtoRefId = item.produto_ref_id; 

        const nivelBaixoOriginal = configExistente?.nivel_estoque_baixo ?? '';
        const nivelUrgenteOriginal = configExistente?.nivel_reposicao_urgente ?? '';
        const nivelIdealOriginal = configExistente?.nivel_estoque_ideal ?? ''; // NOVO
        const ativoOriginal = configExistente?.ativo !== false;

        tr.innerHTML = `
            <td data-label="Produto/Variação">${item.nome_completo}</td>
            <td data-label="Nível Estoque Baixo">
                <input type="number" class="es-input input-nivel-baixo" value="${nivelBaixoOriginal}" placeholder="0" min="0" data-original-value="${nivelBaixoOriginal}">
            </td>
            <td data-label="Nível Rep. Urgente">
                <input type="number" class="es-input input-nivel-urgente" value="${nivelUrgenteOriginal}" placeholder="0" min="0" data-original-value="${nivelUrgenteOriginal}">
            </td>
            <!-- NOVO INPUT PARA ESTOQUE IDEAL -->
            <td data-label="Nível Estoque Ideal">
                <input type="number" class="es-input input-nivel-ideal" value="${nivelIdealOriginal}" placeholder="0" min="0" data-original-value="${nivelIdealOriginal}">
            </td>
            <td data-label="Ativo" style="text-align:center;">
                <input type="checkbox" class="input-nivel-ativo" ${ativoOriginal ? 'checked' : ''} data-original-value="${ativoOriginal}">
            </td>
        `;
    });
}

async function salvarNiveisEmLote() {
    const validationMsgEl = document.getElementById('niveisLoteValidationMessage');
    if (validationMsgEl) { validationMsgEl.textContent = ''; validationMsgEl.style.display = 'none'; }

    const configsParaSalvar = [];
    const linhasTabela = document.querySelectorAll('#tbodyConfigNiveis tr');
    let algumaValidacaoFalhou = false;
    let errosDeValidacao = [];

    linhasTabela.forEach(tr => {
        tr.classList.remove('linha-erro-validacao');
        const inputBaixoEl = tr.querySelector('.input-nivel-baixo');
        const inputUrgenteEl = tr.querySelector('.input-nivel-urgente');
        const inputIdealEl = tr.querySelector('.input-nivel-ideal'); // NOVO
        const inputAtivoEl = tr.querySelector('.input-nivel-ativo');
        if (!inputBaixoEl || !inputUrgenteEl || !inputIdealEl || !inputAtivoEl) return;

        const produtoRefId = tr.dataset.produtoRefId;
        const nomeCompletoProduto = tr.cells[0].textContent;
        
        const valBaixoStr = inputBaixoEl.value.trim();
        const valUrgenteStr = inputUrgenteEl.value.trim();
        const valIdealStr = inputIdealEl.value.trim(); // NOVO
        const ativo = inputAtivoEl.checked;

        const originalBaixo = inputBaixoEl.dataset.originalValue;
        const originalUrgente = inputUrgenteEl.dataset.originalValue;
        const originalIdeal = inputIdealEl.dataset.originalValue; // NOVO
        const originalAtivo = inputAtivoEl.dataset.originalValue === 'true';

        const precisaSalvar = valBaixoStr !== originalBaixo || valUrgenteStr !== originalUrgente || valIdealStr !== originalIdeal || ativo !== originalAtivo;

        if (precisaSalvar) {
            let nivelBaixo = null, nivelUrgente = null, nivelIdeal = null; // NOVO
            let linhaValida = true;

            if (valBaixoStr !== '') nivelBaixo = parseInt(valBaixoStr);
            if (valUrgenteStr !== '') nivelUrgente = parseInt(valUrgenteStr);
            if (valIdealStr !== '') nivelIdeal = parseInt(valIdealStr); // NOVO

            // Validações
            if (valIdealStr !== '' && (isNaN(nivelIdeal) || nivelIdeal < 0)) { errosDeValidacao.push(`"${nomeCompletoProduto}": Nível Ideal inválido.`); linhaValida = false; }
            if (valBaixoStr !== '' && (isNaN(nivelBaixo) || nivelBaixo < 0)) { errosDeValidacao.push(`"${nomeCompletoProduto}": Nível Baixo inválido.`); linhaValida = false; }
            if (valUrgenteStr !== '' && (isNaN(nivelUrgente) || nivelUrgente < 0)) { errosDeValidacao.push(`"${nomeCompletoProduto}": Nível Urgente inválido.`); linhaValida = false; }
            if (nivelUrgente !== null && nivelBaixo !== null && nivelUrgente > nivelBaixo) { errosDeValidacao.push(`"${nomeCompletoProduto}": Urgente > Baixo.`); linhaValida = false; }
            if (nivelBaixo !== null && nivelIdeal !== null && nivelBaixo > nivelIdeal) { errosDeValidacao.push(`"${nomeCompletoProduto}": Baixo > Ideal.`); linhaValida = false; }

            if (linhaValida) {
                configsParaSalvar.push({
                    produto_ref_id: produtoRefId,
                    nivel_estoque_baixo: nivelBaixo,
                    nivel_reposicao_urgente: nivelUrgente,
                    nivel_estoque_ideal: nivelIdeal, // NOVO
                    ativo: ativo
                });
            } else {
                algumaValidacaoFalhou = true;
                tr.classList.add('linha-erro-validacao');
            }
        }
    });

    if (algumaValidacaoFalhou) {
        if (validationMsgEl) {
            validationMsgEl.innerHTML = `Corrija os erros:<br>${errosDeValidacao.join('<br>')}`;
            validationMsgEl.style.display = 'block';
        }
        mostrarMensagem('Existem erros de validação.', 'erro');
        return;
    }

    if (configsParaSalvar.length === 0) {
        mostrarMensagem('Nenhuma alteração para salvar.', 'info');
        return;
    }

    const btnSalvarLoteEl = document.getElementById('btnSalvarNiveisEmLote');
    const originalText = btnSalvarLoteEl.textContent;
    btnSalvarLoteEl.disabled = true;
    btnSalvarLoteEl.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Salvando...`;

    try {
        await fetchEstoqueAPI('/niveis-estoque/batch', { method: 'POST', body: JSON.stringify({ configs: configsParaSalvar }) });
        mostrarMensagem('Configurações de nível salvas com sucesso!', 'sucesso');
        
        // Atualiza cache local
        configsParaSalvar.forEach(savedConfig => {
            const index = niveisEstoqueAlertaCache.findIndex(c => c.produto_ref_id === savedConfig.produto_ref_id);
            if (index > -1) niveisEstoqueAlertaCache[index] = { ...niveisEstoqueAlertaCache[index], ...savedConfig };
            else niveisEstoqueAlertaCache.push(savedConfig);
        });

        fecharModalNiveis();
        await carregarTabelaEstoque(document.getElementById('searchEstoque')?.value || '');
    } catch (error) {
        mostrarMensagem(`Erro ao salvar: ${error.data?.details || error.message}`, 'erro');
    } finally {
        if (btnSalvarLoteEl) { btnSalvarLoteEl.disabled = false; btnSalvarLoteEl.innerHTML = originalText; }
    }
}


function fecharModalNiveis() {
     if (modalNiveisElement) modalNiveisElement.style.display = 'none';
     if (formModalNiveisElement) formModalNiveisElement.reset();
     editandoNivelId = null; 
     produtoSelecionadoParaConfigNiveis = null;
     if(selectProdutoNiveisElement) selectProdutoNiveisElement.value = '';
     if(inputNivelBaixoElement) inputNivelBaixoElement.disabled = true;
     if(inputNivelUrgenteElement) inputNivelUrgenteElement.disabled = true;
     if(niveisValidationMessageElement) niveisValidationMessageElement.style.display = 'none';
 }
// --- FIM DA LÓGICA DE NÍVEIS ---

async function abrirModalHistoricoGeralEstoque() {
    const modal = document.getElementById('modalHistoricoGeralEstoque');
    if (!modal) return;
    
    adicionarBotaoFechar(modal, fecharModalHistoricoGeralEstoque);
    modal.style.display = 'flex';
    
    await carregarHistoricoGeralEstoque(1);
}

function fecharModalHistoricoGeralEstoque() {
    const modal = document.getElementById('modalHistoricoGeralEstoque');
    if (modal) modal.style.display = 'none';
}

async function carregarHistoricoGeralEstoque(page = 1) {
    historicoGeralEstoquePage = page;
    const tbody = document.getElementById('tabelaHistoricoGeralEstoqueBody');
    const paginacaoContainer = document.getElementById('paginacaoHistoricoGeralEstoque');
    tbody.innerHTML = `<tr><td colspan="4">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm' })}</td></tr>`;

    try {
        const tipoEvento = document.getElementById('filtroEventoEstoque').value;
        const periodo = document.getElementById('filtroPeriodoEstoque').value;

        const params = new URLSearchParams({
            tipoEvento,
            periodo,
            page,
            limit: 15
        });

        const response = await fetchEstoqueAPI(`/estoque/auditoria?${params.toString()}`);
        const { rows, pagination } = response;

        tbody.innerHTML = '';
        if (rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4">${htmlUIFeedbackNotFound({
                icon: 'fa-calendar-xmark',
                titulo: 'Nenhum evento encontrado',
                mensagem: 'Não há eventos para os filtros selecionados.',
            })}</td></tr>`;
        } else {
            rows.forEach(evento => {
                const tr = tbody.insertRow();
                let detalhesHtml = '';
                if (evento.detalhes) {
                    detalhesHtml = Object.entries(evento.detalhes)
                        .filter(([key, value]) => value !== null && value !== '') 
                        .map(([key, value]) => {
                            // Transforma a chave em um texto mais legível
                            const chaveFormatada = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            return `<strong>${chaveFormatada}:</strong> ${value}`;
                        })
                        .join('<br>');
                }

                tr.innerHTML = `
                    <td data-label="Data">${new Date(evento.data_evento).toLocaleString('pt-BR')}</td>
                    <td data-label="Usuário">${evento.usuario_nome || 'N/A'}</td>
                    <td data-label="Ação">${evento.tipo_evento.replace(/_/g, ' ')}</td>
                    <td data-label="Detalhes">${detalhesHtml}</td>
                `;
            });
        }

        // Lógica de paginação (usando uma função genérica seria ideal, mas por enquanto fazemos aqui)
        paginacaoContainer.innerHTML = '';
        if (pagination.totalPages > 1) {
            paginacaoContainer.style.display = 'flex';
            // Adicionar botões de paginação...
            // (O código de renderizarPaginacao pode ser adaptado aqui)
        } else {
            paginacaoContainer.style.display = 'none';
        }

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Erro ao carregar histórico.</td></tr>`;
    }
}



// --- LÓGICA DE DADOS E TABELA PRINCIPAL (Sem alterações significativas) ---
function gerarFiltrosDinamicos() {
    const chavesDeVariacao = new Map();

    // 1. Mapeia todas as chaves de variação e seus valores
    todosOsProdutosCadastrados.forEach(p => {
        if (p.variacoes && Array.isArray(p.variacoes)) {
            p.variacoes.forEach(variacao => {
                let chaveNormalizada = variacao.chave.toLowerCase().trim();
                if (!chavesDeVariacao.has(chaveNormalizada)) {
                    chavesDeVariacao.set(chaveNormalizada, new Set());
                }
                const valores = variacao.valores.split(',').map(v => v.trim()).filter(Boolean);
                valores.forEach(val => chavesDeVariacao.get(chaveNormalizada).add(val));
            });
        }
    });

    // 2. Pega os containers dos filtros no HTML
    const containerFiltroEstoque = document.getElementById('filtrosAvancados');
    const containerFiltroFila = document.getElementById('filtrosFilaDinamicos'); // Mantém para a outra view

    if (!containerFiltroEstoque || !containerFiltroFila) {
        console.error("Containers de filtro (#filtrosAvancados ou #filtrosFilaDinamicos) não encontrados.");
        return;
    }

    // Limpa os containers antes de adicionar os novos filtros
    containerFiltroEstoque.innerHTML = '';
    containerFiltroFila.innerHTML = '';

    // 3. Cria os selects para cada chave de variação
    chavesDeVariacao.forEach((valoresSet, chaveNormalizada) => {
        const labelAmigavel = chaveNormalizada.charAt(0).toUpperCase() + chaveNormalizada.slice(1);

        // --- Cria o select para o filtro de ESTOQUE ---
        const grupoEstoque = document.createElement('div');
        grupoEstoque.className = 'es-form-grupo';
        
        const labelEstoque = document.createElement('label'); // Adiciona um label
        labelEstoque.htmlFor = `filtro-estoque-${chaveNormalizada}`;
        labelEstoque.textContent = labelAmigavel;
        
        const selectEstoque = document.createElement('select');
        selectEstoque.id = `filtro-estoque-${chaveNormalizada}`;
        selectEstoque.className = 'es-select filtro-dinamico-estoque';
        selectEstoque.dataset.chave = chaveNormalizada; 
        
        let optionsHTML = `<option value="">Toda(o)s ${labelAmigavel}</option>`;
        Array.from(valoresSet).sort().forEach(val => {
            optionsHTML += `<option value="${val}">${val}</option>`;
        });
        selectEstoque.innerHTML = optionsHTML;
        selectEstoque.addEventListener('change', () => carregarTabelaEstoque());
        
        grupoEstoque.appendChild(labelEstoque);
        grupoEstoque.appendChild(selectEstoque);
        containerFiltroEstoque.appendChild(grupoEstoque);

        // --- Cria o select para o filtro da FILA DE PRODUÇÃO ---
        const grupoFila = document.createElement('div');
        grupoFila.className = 'es-form-grupo';
        
        const labelFila = labelEstoque.cloneNode(true); // Clona o label
        labelFila.htmlFor = `filtro-fila-${chaveNormalizada}`;
        
        const selectFila = selectEstoque.cloneNode(true); // Clona o select
        selectFila.id = `filtro-fila-${chaveNormalizada}`;
        selectFila.className = 'es-select filtro-dinamico-fila';
        selectFila.addEventListener('change', renderizarFilaDeProducao);
        
        grupoFila.appendChild(labelFila);
        grupoFila.appendChild(selectFila);
        containerFiltroFila.appendChild(grupoFila);
    });

    // 4. Adiciona o botão de limpar filtros ao final do container de ESTOQUE
    const grupoBotaoEstoque = document.createElement('div');
    grupoBotaoEstoque.className = 'es-form-grupo';
    grupoBotaoEstoque.style.justifyContent = 'flex-end'; // Alinha o botão

    const btnLimparEstoque = document.createElement('button');
    btnLimparEstoque.id = 'limparFiltrosEstoqueBtn';
    btnLimparEstoque.className = 'es-btn-limpar-filtros'; // Usa a mesma classe do outro botão
    btnLimparEstoque.innerHTML = '<i class="fas fa-times-circle"></i> Limpar Filtros';

    btnLimparEstoque.addEventListener('click', () => {
        document.querySelectorAll('.filtro-dinamico-estoque').forEach(s => s.value = '');
        document.getElementById('searchEstoque').value = '';
        carregarTabelaEstoque();

        // Lógica para resetar o botão "Filtros Avançados"
        const toggleBtn = document.getElementById('toggleFiltrosAvancadosBtn');
        const filtrosCont = document.getElementById('filtrosAvancados');
        if (toggleBtn && filtrosCont) {
            filtrosCont.classList.add('hidden');
            const span = toggleBtn.querySelector('span');
            if (span) {
                span.textContent = 'Filtros Avançados';
            }
        }
    });

    grupoBotaoEstoque.appendChild(btnLimparEstoque); // Não precisa de label para o botão
    containerFiltroEstoque.appendChild(grupoBotaoEstoque);
}



async function obterSaldoEstoqueAtualAPI() {
    console.log('[obterSaldoEstoqueAtualAPI] Buscando saldo do estoque...');
    try {
        const saldo = await fetchEstoqueAPI('/estoque/saldo'); 
        saldosEstoqueGlobaisCompletos = saldo || [];
        return saldosEstoqueGlobaisCompletos;
    } catch (error) {
        console.error('[obterSaldoEstoqueAtualAPI] Erro ao buscar saldo:', error);
        mostrarMensagem('Falha ao carregar dados do estoque.', 'erro');
        return [];
    }
}

async function carregarTabelaEstoque(searchTerm = null, page = 1) {
    // Pega o termo de busca do input se não for passado como argumento, para manter o estado
    const termoBusca = searchTerm !== null ? searchTerm : (document.getElementById('searchEstoque')?.value || '');
    
    // Se uma busca for feita, reseta o filtro de alerta ativo para não haver conflito
    if (termoBusca && filtroAlertaAtivo) {
        filtroAlertaAtivo = null;
        document.getElementById('filtroAtivoHeader').style.display = 'none';
        document.querySelectorAll('.es-alerta-card').forEach(c => c.classList.remove('filtro-ativo'));
    }
    
    currentPageEstoqueTabela = parseInt(page) || 1;
    const container = document.getElementById('estoqueCardsContainer');
    if (!container) return;
    container.innerHTML = htmlUICarregando({ texto: 'Atualizando itens...' });
    
    try {
        let dadosDeSaldo;
        // Força a busca na API se os dados ainda não foram carregados ou se um filtro de alerta foi clicado
        if (saldosEstoqueGlobaisCompletos.length === 0 || filtroAlertaAtivo) {
            dadosDeSaldo = await obterSaldoEstoqueAtualAPI(); 
        } else {
            dadosDeSaldo = [...saldosEstoqueGlobaisCompletos];
        }

        // Garante que os dados de produtos e níveis de alerta estão carregados
        const [todosProdutosDef, niveisDeAlertaApi] = await Promise.all([
            obterProdutos(), 
            niveisEstoqueAlertaCache.length > 0 ? Promise.resolve([...niveisEstoqueAlertaCache]) : fetchEstoqueAPI('/niveis-estoque')
        ]);
        if (niveisEstoqueAlertaCache.length === 0) niveisEstoqueAlertaCache = Array.isArray(niveisDeAlertaApi) ? niveisDeAlertaApi : [];
        const niveisAlertaValidos = niveisEstoqueAlertaCache;

        // Atualiza os contadores dos cards de alerta
        let countUrgente = 0, countBaixo = 0;
        dadosDeSaldo.forEach(item => {
            const configNivel = niveisAlertaValidos.find(n => n.produto_ref_id === item.produto_ref_id && n.ativo);
            if (configNivel) {
                const saldoNum = parseFloat(item.saldo_atual);
                if (configNivel.nivel_reposicao_urgente !== null && saldoNum <= configNivel.nivel_reposicao_urgente) countUrgente++;
                else if (configNivel.nivel_estoque_baixo !== null && saldoNum <= configNivel.nivel_estoque_baixo) countBaixo++;
            }
        });
        const iconeUrgente = document.querySelector('#cardReposicaoUrgente .es-alerta-icone');
        if (iconeUrgente) iconeUrgente.classList.toggle('icone-piscando', countUrgente > 0);
        document.getElementById('contadorUrgente').textContent = countUrgente;
        document.getElementById('contadorBaixo').textContent = countBaixo;

        // Começa a filtrar a lista de itens
        let itensFiltrados = [...dadosDeSaldo];
        
        // Aplica o filtro de alerta (se ativo)
        if (filtroAlertaAtivo) {
            itensFiltrados = itensFiltrados.filter(item => {
                const configNivel = niveisAlertaValidos.find(n => n.produto_ref_id === item.produto_ref_id && n.ativo);
                if (!configNivel) return false;
                const saldoNum = parseFloat(item.saldo_atual);
                if (filtroAlertaAtivo === 'urgente') return configNivel.nivel_reposicao_urgente !== null && saldoNum <= configNivel.nivel_reposicao_urgente;
                if (filtroAlertaAtivo === 'baixo') return configNivel.nivel_estoque_baixo !== null && saldoNum <= configNivel.nivel_estoque_baixo && (configNivel.nivel_reposicao_urgente === null || saldoNum > configNivel.nivel_reposicao_urgente);
                return false;
            });
        }
        
        // Aplica o filtro de busca por texto
        if (termoBusca) {
            const termo = termoBusca.toLowerCase();
            itensFiltrados = itensFiltrados.filter(item =>
                item.produto_nome.toLowerCase().includes(termo) ||
                (item.variante_nome && item.variante_nome.toLowerCase().includes(termo)) ||
                (item.produto_ref_id && item.produto_ref_id.toLowerCase().includes(termo))
            );
        }

        // Aplica os filtros avançados (selects dinâmicos)
        const filtrosAtivos = {};
    document.querySelectorAll('.filtro-dinamico-estoque').forEach(select => {
        if (select.value) {
            // Usa a chave normalizada do dataset
            filtrosAtivos[select.dataset.chave] = select.value;
        }
    });

    if (Object.keys(filtrosAtivos).length > 0) {
        itensFiltrados = itensFiltrados.filter(item => {
            // Usa o ID para encontrar a definição do produto
            const produtoDef = todosOsProdutosCadastrados.find(p => p.id == item.produto_id);
            if (!produtoDef || !produtoDef.variacoes) return false;

            return Object.entries(filtrosAtivos).every(([chaveFiltro, valorFiltro]) => {
                // Encontra a definição da variação no produto, ignorando maiúsculas/minúsculas
                const variacaoDef = produtoDef.variacoes.find(v => v.chave.toLowerCase().trim() === chaveFiltro);
                if (!variacaoDef) return false;
                
                // Encontra a posição (índice) da variação para poder comparar com o valor
                const indexVariacao = produtoDef.variacoes.indexOf(variacaoDef);
                const valoresItem = item.variante_nome?.split(' | ').map(v => v.trim()) || [];
                
                return valoresItem[indexVariacao] === valorFiltro;
            });
        });
    }
        
        // Pagina o resultado final
        const totalItems = itensFiltrados.length;
        const totalPages = Math.ceil(totalItems / itemsPerPageEstoqueTabela) || 1;
        currentPageEstoqueTabela = Math.min(currentPageEstoqueTabela, totalPages);
        const itensPaginados = itensFiltrados.slice((currentPageEstoqueTabela - 1) * itemsPerPageEstoqueTabela, currentPageEstoqueTabela * itemsPerPageEstoqueTabela);
           
        // Renderiza o resultado
        renderizarCardsConsulta(itensPaginados, todosProdutosDef, niveisAlertaValidos);
        renderizarPaginacaoEstoque(totalPages, termoBusca); // Passa o termo de busca para a paginação

        // Controla a visibilidade do botão "Mostrar Todos"
        const btnMostrarTodosEl = document.getElementById('btnMostrarTodosEstoque');
        if (btnMostrarTodosEl) {
            btnMostrarTodosEl.style.display = (filtroAlertaAtivo || termoBusca || Object.keys(filtrosAtivos).length > 0) ? 'inline-flex' : 'none';
        }
    } catch (error) { 
        container.innerHTML = `<p style="text-align: center; color: red; grid-column: 1 / -1;">Erro ao carregar estoque.</p>`;
    }
}

// FUNÇÃO para renderizar os cards em vez da tabela
function renderizarCardsConsulta(itensDeEstoque, produtosDefinicoes, niveisDeAlerta) {
    const container = document.getElementById('estoqueCardsContainer');
    if (!container) return;
    container.innerHTML = '';

    if (itensDeEstoque.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-box-open',
            titulo: 'Nenhum item encontrado',
            mensagem: 'Não há itens correspondentes aos filtros atuais.',
        });
        return;
    }

    const fragment = document.createDocumentFragment();
    itensDeEstoque.forEach(item => {
        const produtoDef = produtosDefinicoes.find(p => p.id == item.produto_id);
        let imagemSrc = '/img/placeholder-image.png';
        if (produtoDef) {
            const gradeItem = produtoDef.grade?.find(g => g.variacao === item.variante_nome);
            imagemSrc = gradeItem?.imagem || produtoDef.imagem || '/img/placeholder-image.png';
        }

        const configNivel = niveisDeAlerta.find(n => n.produto_ref_id === item.produto_ref_id && n.ativo);
        let statusClass = 'status-ok';
        if (configNivel) {
            const saldoNum = parseFloat(item.saldo_atual);
            if (configNivel.nivel_reposicao_urgente !== null && saldoNum <= configNivel.nivel_reposicao_urgente) statusClass = 'status-urgente';
            else if (configNivel.nivel_estoque_baixo !== null && saldoNum <= configNivel.nivel_estoque_baixo) statusClass = 'status-baixo';
        }

        const card = document.createElement('div');
        card.className = `es-consulta-card ${statusClass}`;
        card.dataset.itemEstoque = JSON.stringify(item);
        
        // --- ESTRUTURA HTML SIMPLIFICADA ---
        // Não usamos mais o wrapper extra. O CSS vai cuidar de tudo.
        card.innerHTML = `
            <img src="${imagemSrc}" alt="${item.produto_nome}" class="es-consulta-card-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
            
            <div class="es-consulta-card-info">
                <h3>${item.produto_nome}</h3>
                <p>${item.variante_nome || 'Padrão'}</p>
                <p class="sku-info">SKU: ${item.produto_ref_id || 'N/A'}</p>
            </div>

            <div class="es-consulta-card-dados">
                <div class="dado-bloco">
                    <span class="label">Ideal</span>
                    <span class="valor">${configNivel?.nivel_estoque_ideal ?? '-'}</span>
                </div>
                <div class="dado-bloco">
                    <span class="label">Saldo</span>
                    <span class="valor saldo-atual">${item.saldo_atual}</span>
                </div>
            </div>
        `;

        if (permissoesGlobaisEstoque.includes('gerenciar-estoque')) {
            card.addEventListener('click', (event) => {
                const itemClicado = JSON.parse(event.currentTarget.dataset.itemEstoque);
                abrirViewMovimento(itemClicado);
            });
        }
        fragment.appendChild(card);
    });
    container.appendChild(fragment);
}


function renderizarPaginacaoEstoque(totalPages, searchTermAtual = '') {
    const paginacaoContainer = document.getElementById('estoquePaginacaoContainer');
    if (!paginacaoContainer) return;
    paginacaoContainer.innerHTML = '';

    if (totalPages <= 1) {
        paginacaoContainer.style.display = 'none';
        return;
    }
    paginacaoContainer.style.display = 'flex';

    paginacaoContainer.innerHTML = `
        <button class="pagination-btn es-btn" data-page="${Math.max(1, currentPageEstoqueTabela - 1)}" ${currentPageEstoqueTabela === 1 ? 'disabled' : ''}>Anterior</button>
        <span class="pagination-current">Pág. ${currentPageEstoqueTabela} de ${totalPages}</span>
        <button class="pagination-btn es-btn" data-page="${Math.min(totalPages, currentPageEstoqueTabela + 1)}" ${currentPageEstoqueTabela === totalPages ? 'disabled' : ''}>Próximo</button>
    `;

    paginacaoContainer.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPage = parseInt(btn.dataset.page);
            carregarTabelaEstoque(searchTermAtual, targetPage); 
        });
    });
}

async function filtrarEstoquePorAlerta(tipoAlerta) {
    filtroAlertaAtivo = tipoAlerta; 
    const searchInput = document.getElementById('searchEstoque');
    if(searchInput) searchInput.value = ''; 
    currentPageEstoqueTabela = 1;

    // NOVO: Adiciona a lógica de feedback visual
    const headerFiltro = document.getElementById('filtroAtivoHeader');
    const tituloFiltro = document.getElementById('filtroAtivoTitulo');
    document.querySelectorAll('.es-alerta-card').forEach(c => c.classList.remove('filtro-ativo'));

    if (tipoAlerta === 'urgente') {
        headerFiltro.className = 'es-filtro-ativo-header urgente';
        tituloFiltro.textContent = 'Mostrando Itens com Reposição Urgente';
        headerFiltro.style.display = 'block';
        document.getElementById('cardReposicaoUrgente')?.classList.add('filtro-ativo');
    } else if (tipoAlerta === 'baixo') {
        headerFiltro.className = 'es-filtro-ativo-header baixo';
        tituloFiltro.textContent = 'Mostrando Itens com Estoque Baixo';
        headerFiltro.style.display = 'block';
        document.getElementById('cardEstoqueBaixo')?.classList.add('filtro-ativo');
    }

    await carregarTabelaEstoque('', 1);
    
    const tabelaEl = document.getElementById('estoqueTable');
    if(tabelaEl) tabelaEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function mostrarViewFilaProducao() {
    if (!permissoesGlobaisEstoque.includes('acesso-estoque')) {
        mostrarMensagem('Você não tem permissão para acessar esta área.', 'aviso');
        return;
    }

    const overlay = document.getElementById('filaLoadingOverlay');
    // Mostra o overlay e esconde as views antigas
    if (overlay) overlay.classList.remove('hidden');
    document.getElementById('mainViewEstoque').style.display = 'none';
    
    const filaView = document.getElementById('filaProducaoView');
    filaView.classList.remove('hidden');
    filaView.style.display = 'block';

    adicionarBotaoFechar(filaView, voltarDaFilaParaEstoque);


    try {
        const btnSalvar = document.getElementById('btnSalvarPrioridades');
        btnSalvar.classList.toggle('hidden', !permissoesGlobaisEstoque.includes('gerenciar-fila-de-producao'));

        // Busca as promessas ativas do backend
        promessasDeProducaoCache = await fetchEstoqueAPI('/producao-promessas');
        
        // ### LÓGICA PARA POPULAR O NOVO FILTRO ###
        const filtroProdutoSelect = document.getElementById('filtroFilaProdutoSelect');
        const nomesDeProdutos = [...new Set(todosOsProdutosCadastrados.map(p => p.nome))].sort();
        
        // Preserva a opção "Todos" e adiciona as outras
        filtroProdutoSelect.innerHTML = `<option value="">Todos os Produtos</option>`;
        nomesDeProdutos.forEach(nome => {
            filtroProdutoSelect.innerHTML += `<option value="${nome}">${nome}</option>`;
        });
        // Adiciona o listener para reagir a mudanças
        filtroProdutoSelect.addEventListener('change', renderizarFilaDeProducao);
        // #########################################

        // Renderiza as duas abas
        renderizarFilaDeProducao();
        renderizarPromessasEmProducao();

        // Configura troca de abas
        mudarAbaFila('prioridades');

    } catch(error) {
        console.error("Erro ao carregar fila de produção:", error);
        mostrarMensagem("Erro ao carregar a fila de produção.", "erro");
    } finally {
        // Esconde o overlay DEPOIS que tudo carregou
        if (overlay) overlay.classList.add('hidden');
    }
}

function moverItemFila(produtoRefId, direcao) {
    const container = document.getElementById('filaProducaoContainer');
    const cards = Array.from(container.querySelectorAll('.es-fila-card'));
    const indexAtual = cards.findIndex(card => card.dataset.produtoRefId === produtoRefId);

    if (indexAtual === -1) return;

    let indexNovo = indexAtual + direcao;

    // Garante que o novo índice não saia dos limites do array
    if (indexNovo < 0 || indexNovo >= cards.length) return;

    const cardAtual = cards[indexAtual];
    const cardAlvo = cards[indexNovo];

    // Troca a posição dos elementos no DOM
    if (direcao === -1) { // Mover para cima
        container.insertBefore(cardAtual, cardAlvo);
    } else { // Mover para baixo
        container.insertBefore(cardAlvo, cardAtual);
    }
    
    // Marca que a ordem foi alterada para habilitar o botão de salvar
    const btnSalvar = document.getElementById('btnSalvarPrioridades');
    if(btnSalvar) {
        btnSalvar.style.backgroundColor = 'var(--gs-sucesso)';
        btnSalvar.disabled = false;
    }

    atualizarInterfaceFila();
}

function atualizarInterfaceFila() {
    const container = document.getElementById('filaProducaoContainer');
    const cards = container.querySelectorAll('.es-fila-card');
    
    cards.forEach((card, index) => {
        // Atualiza o número da posição
        card.querySelector('.fila-card-posicao').textContent = `#${index + 1}`;

        // Habilita/desabilita os botões de seta
        const btnCima = card.querySelector('.reordenar-btn.up');
        const btnBaixo = card.querySelector('.reordenar-btn.down');

        if (btnCima) btnCima.disabled = (index === 0);
        if (btnBaixo) btnBaixo.disabled = (index === cards.length - 1);
    });
}


function voltarDaFilaParaEstoque() {
    document.getElementById('filaProducaoView').style.display = 'none';
    document.getElementById('mainViewEstoque').style.display = 'block';
}

function renderizarFilaDeProducao() {
    const container = document.getElementById('filaProducaoContainer');
    container.innerHTML = htmlUICarregando({ variante: 'bloco', tamanho: 'sm' });

    // 1. Pega os valores dos filtros da fila
    const statusFiltro = document.getElementById('filtroFilaStatusSelect').value;
    const produtoFiltro = document.getElementById('filtroFilaProdutoSelect').value; // <<< LÊ O NOVO FILTRO
    const filtrosDinamicosFila = {};
    document.querySelectorAll('.filtro-dinamico-fila').forEach(select => {
        if (select.value) {
            filtrosDinamicosFila[select.dataset.chave] = select.value;
        }
    });

    const idsEmProducao = new Set(promessasDeProducaoCache.map(p => p.produto_ref_id));
    
    // 2. Começa com a lista base de itens que precisam de produção
    let itensFiltrados = niveisEstoqueAlertaCache
        .filter(config => {
            if (!config.ativo || idsEmProducao.has(config.produto_ref_id)) return false;
            const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === config.produto_ref_id);
            if (!itemSaldo) return false;
            const saldoNum = parseFloat(itemSaldo.saldo_atual);
            return (config.nivel_reposicao_urgente !== null && saldoNum <= config.nivel_reposicao_urgente) ||
                   (config.nivel_estoque_baixo !== null && saldoNum <= config.nivel_estoque_baixo);
        });

    // 3. Aplica os filtros
    if (produtoFiltro) {
        itensFiltrados = itensFiltrados.filter(config => {
            // Precisamos encontrar o nome do produto a partir do produto_ref_id
            const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === config.produto_ref_id);
            return itemSaldo && itemSaldo.produto_nome === produtoFiltro;
        });
    }

    if (statusFiltro) {
        itensFiltrados = itensFiltrados.filter(config => {
            const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === config.produto_ref_id);
            if (!itemSaldo) return false;
            const saldoNum = parseFloat(itemSaldo.saldo_atual);
            if (statusFiltro === 'urgente') {
                return config.nivel_reposicao_urgente !== null && saldoNum <= config.nivel_reposicao_urgente;
            }
            if (statusFiltro === 'baixo') {
                return config.nivel_estoque_baixo !== null && saldoNum <= config.nivel_estoque_baixo &&
                       (config.nivel_reposicao_urgente === null || saldoNum > config.nivel_reposicao_urgente);
            }
            return true;
        });
    }

    if (Object.keys(filtrosDinamicosFila).length > 0) {
        itensFiltrados = itensFiltrados.filter(config => {
            const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === config.produto_ref_id);
            if (!itemSaldo) return false;
            const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === itemSaldo.produto_nome);
            if (!produtoDef || !produtoDef.variacoes) return false;

            return Object.entries(filtrosDinamicosFila).every(([chave, valor]) => {
                const variacaoDef = produtoDef.variacoes.find(v => v.chave === chave);
                if (!variacaoDef) return false;
                
                const indexVariacao = produtoDef.variacoes.indexOf(variacaoDef);
                const valoresItem = itemSaldo.variante_nome?.split(' | ').map(v => v.trim()) || [];
                
                return valoresItem[indexVariacao] === valor;
            });
        });
    }
    
    // 4. Ordena e renderiza o resultado final
    const itensParaRenderizar = itensFiltrados.sort((a, b) => (a.prioridade || 99) - (b.prioridade || 99));

    container.innerHTML = '';
    if (itensParaRenderizar.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-list-ol',
            titulo: 'Nenhum item na fila de prioridades',
            mensagem: 'Não há itens correspondentes aos filtros selecionados.',
        });
        return;
    }

    itensParaRenderizar.forEach((config, index) => {
        const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === config.produto_ref_id);
        const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === itemSaldo.produto_nome);
        
        let imagemSrc = '/img/placeholder-image.png';
        if (produtoDef) {
            const gradeItem = produtoDef.grade?.find(g => g.variacao === itemSaldo.variante_nome);
            imagemSrc = gradeItem?.imagem || produtoDef.imagem || '/img/placeholder-image.png';
        }

        const saldoNum = parseFloat(itemSaldo.saldo_atual);
        const status = (config.nivel_reposicao_urgente !== null && saldoNum <= config.nivel_reposicao_urgente) ? 'urgente' : 'baixo';
        
        const card = document.createElement('div');
        card.className = `es-fila-card status-${status}`;
        card.dataset.produtoRefId = config.produto_ref_id;

        const podeGerenciarFila = permissoesGlobaisEstoque.includes('gerenciar-fila-de-producao');

        const reordenarHTML = podeGerenciarFila
            ? `<div class="fila-card-reordenar">
                   <button class="reordenar-btn up" onclick="moverItemFila('${config.produto_ref_id}', -1)" title="Mover para cima"><i class="fas fa-arrow-up"></i></button>
                   <button class="reordenar-btn down" onclick="moverItemFila('${config.produto_ref_id}', 1)" title="Mover para baixo"><i class="fas fa-arrow-down"></i></button>
               </div>`
            : '';
        
        const acaoProducaoHTML = podeGerenciarFila
            ? `<div class="fila-card-acao-producao">
                   <button class="es-btn-icon-estorno" onclick="iniciarProducao('${config.produto_ref_id}')" title="Iniciar Produção"><i class="fas fa-play-circle"></i></button>
               </div>`
            : '';

        card.innerHTML = `
            <div class="fila-card-ordenacao-wrapper ${podeGerenciarFila ? 'pode-arrastar' : ''}" 
                 ${podeGerenciarFila ? `draggable="true" title="Arraste para reordenar"` : ''}>
                ${reordenarHTML}
                <div class="fila-card-posicao">#${index + 1}</div>
            </div>
            <div class="fila-card-info-wrapper">
                <img src="${imagemSrc}" class="fila-card-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
                <div class="fila-card-info">
                    <h3>${itemSaldo.produto_nome}</h3>
                    <p>${itemSaldo.variante_nome || 'Padrão'}</p>
                </div>
            </div>
            <div class="fila-card-footer">
                <div class="fila-card-dados-producao">
                    <span>Estoque: <strong>${saldoNum}</strong> / Ideal: <strong>${config.nivel_estoque_ideal || '-'}</strong></span>
                </div>
                <div class="fila-card-status-acao-wrapper">
                    <div class="fila-card-status-badge status-${status}">${status.toUpperCase()}</div>
                    ${acaoProducaoHTML}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
    
    atualizarInterfaceFila();
}

function mudarAbaFila(abaAtiva) {
    document.querySelectorAll('.es-tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === abaAtiva);
    });
    document.querySelectorAll('.es-tab-panel').forEach(panel => {
        panel.style.display = (panel.id === `tab-${abaAtiva}`) ? 'block' : 'none';
    });
}

function renderizarPromessasEmProducao() {
    const container = document.getElementById('emProducaoContainer');
    const contadorBadge = document.getElementById('contadorEmProducao');
    container.innerHTML = '';
    
    const promessasAtivas = promessasDeProducaoCache.filter(p => new Date(p.data_expiracao) > new Date());
    
    contadorBadge.textContent = promessasAtivas.length;
    contadorBadge.style.display = promessasAtivas.length > 0 ? 'inline-block' : 'none';

    if (promessasAtivas.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-industry',
            titulo: 'Nenhum item em produção',
            mensagem: 'Não há itens em produção neste momento.',
        });
        return;
    }

    promessasAtivas.sort((a,b) => new Date(a.data_expiracao) - new Date(b.data_expiracao));

    promessasAtivas.forEach(promessa => {
        const itemSaldo = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === promessa.produto_ref_id);
        if (!itemSaldo) return; 

        const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === itemSaldo.produto_nome);
        let imagemSrc = '/img/placeholder-image.png';
        if (produtoDef) {
            const gradeItem = produtoDef.grade?.find(g => g.variacao === itemSaldo.variante_nome);
            imagemSrc = gradeItem?.imagem || produtoDef.imagem || '/img/placeholder-image.png';
        }

        const card = document.createElement('div');
        card.className = `es-fila-card status-ok`; 
        card.dataset.promessaId = promessa.id;

        // --- MUDANÇA NA LÓGICA DO BOTÃO ---
        // O botão agora é sempre renderizado.
        // A lógica de permissão será tratada no clique.
        const anularPromessaHTML = `
            <div class="fila-card-acao-producao">
               <button class="es-btn-icon-danger" 
                       onclick="anularPromessa(${promessa.id}, '${itemSaldo.produto_nome.replace(/'/g, "\\'")}')" 
                       title="Anular esta Promessa de Produção">
                   <i class="fas fa-times-circle"></i>
               </button>
           </div>`;

        card.innerHTML = `
            <div class="fila-card-info-wrapper">
                <img src="${imagemSrc}" class="fila-card-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
                <div class="fila-card-info">
                    <h3>${itemSaldo.produto_nome}</h3>
                    <p>${itemSaldo.variante_nome || 'Padrão'}</p>
                </div>
            </div>
            <div class="fila-card-footer">
                <div class="fila-card-dados-producao">
                    <span>Iniciado por: <strong>${promessa.usuario_nome || 'N/A'}</strong></span>
                    <span class="timer" id="timer-${promessa.id}">Calculando...</span>
                </div>
            </div>
            ${anularPromessaHTML}
        `;
        container.appendChild(card);
        iniciarTimerContagemRegressiva(promessa);
    });
}

async function anularPromessa(promessaId, nomeProduto) {
    // --- VERIFICAÇÃO DE PERMISSÃO NO INÍCIO ---
    if (!permissoesGlobaisEstoque.includes('anular-promessa-producao')) {
        mostrarMensagem('Você não tem permissão para anular promessas de produção.', 'aviso');
        return;
    }

    const confirmado = await mostrarConfirmacao(
        `Tem certeza que deseja anular a promessa de produção para <br><b>${nomeProduto}</b>?<br><br>O item voltará para a fila de prioridades.`,
        'perigo'
    );

    if (!confirmado) return;

    try {
        await fetchEstoqueAPI(`/producao-promessas/${promessaId}`, {
            method: 'DELETE',
        });

        promessasDeProducaoCache = promessasDeProducaoCache.filter(p => p.id !== promessaId);

        renderizarFilaDeProducao();
        renderizarPromessasEmProducao();

        mostrarMensagem('Promessa anulada. O item voltou para a fila de prioridades.', 'sucesso');
    } catch (error) {
        mostrarMensagem(`Erro ao anular promessa: ${error.data?.details || error.message}`, 'erro');
    }
}

async function iniciarProducao(produtoRefId) {
    const item = saldosEstoqueGlobaisCompletos.find(s => s.produto_ref_id === produtoRefId);
    const confirmado = await mostrarConfirmacao(`Confirma o início da produção para <br><b>${item.produto_nome} - ${item.variante_nome || 'Padrão'}</b>?`, 'aviso');

    if (!confirmado) return;

    try {
        const novaPromessa = await fetchEstoqueAPI('/producao-promessas', {
            method: 'POST',
            body: JSON.stringify({ produto_ref_id: produtoRefId })
        });
        promessasDeProducaoCache.push(novaPromessa);
        
        // Re-renderiza as duas abas para atualizar as listas
        renderizarFilaDeProducao();
        renderizarPromessasEmProducao();
        
        mostrarMensagem('Item enviado para a fila de produção ativa!', 'sucesso');
    } catch (error) {
        mostrarMensagem(`Erro ao iniciar produção: ${error.message}`, 'erro');
    }
}

function iniciarTimerContagemRegressiva(promessa) {
    const timerEl = document.getElementById(`timer-${promessa.id}`);
    if (!timerEl) return;

    const intervalId = setInterval(() => {
        const agora = new Date();
        const expiracao = new Date(promessa.data_expiracao);
        const diff = expiracao - agora;

        if (diff <= 0) {
            timerEl.textContent = "Expirado! Repriorizar.";
            timerEl.style.color = "red";
            clearInterval(intervalId);
            return;
        }
        const horas = Math.floor((diff / (1000 * 60 * 60)) % 24).toString().padStart(2, '0');
        const minutos = Math.floor((diff / 1000 / 60) % 60).toString().padStart(2, '0');
        const segundos = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        timerEl.textContent = `Expira em: ${horas}:${minutos}:${segundos}`;
    }, 1000);
}



async function salvarPrioridades() {
    const btn = document.getElementById('btnSalvarPrioridades');
    btn.disabled = true;
    btn.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Salvando...`;
    
    const cards = document.querySelectorAll('#filaProducaoContainer .es-fila-card');
    const prioridadesPayload = Array.from(cards).map((card, index) => ({
        produto_ref_id: card.dataset.produtoRefId,
        prioridade: index + 1
    }));

    try {
        await fetchEstoqueAPI('/niveis-estoque/prioridade', {
            method: 'POST',
            body: JSON.stringify({ prioridades: prioridadesPayload })
        });

        // Atualiza o cache local
        prioridadesPayload.forEach(p => {
            const configCache = niveisEstoqueAlertaCache.find(c => c.produto_ref_id === p.produto_ref_id);
            if(configCache) configCache.prioridade = p.prioridade;
        });

        mostrarMensagem('Ordem da fila salva com sucesso!', 'sucesso');
        btn.style.backgroundColor = 'var(--gs-primaria)';
    } catch(error) {
        mostrarMensagem('Erro ao salvar prioridades.', 'erro');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-save"></i> Salvar Ordem da Fila';
    }
}

// --- LÓGICA DA NOVA VIEW DE MOVIMENTAÇÃO DE ESTOQUE ---

// NOVO: Função para abrir a nova view unificada
function abrirViewMovimento(item) {
    console.log('[abrirViewMovimento] Abrindo para o item:', item);
    if (!permissoesGlobaisEstoque.includes('gerenciar-estoque')) {
        mostrarMensagem('Você não tem permissão para gerenciar o estoque.', 'aviso');
        return;
    }
    itemEstoqueSelecionado = { ...item }; // Armazena o item na variável de estado unificada
    window.location.hash = '#editar-estoque-movimento'; // Dispara o handleHashChangeEstoque
}

// Função para preparar e popular a nova view unificada
function prepararViewMovimento() {
    if (!itemEstoqueSelecionado) return;
    const item = itemEstoqueSelecionado;
    
    // Preenche as informações do cabeçalho da view
    document.getElementById('movimentoItemNome').textContent = `${item.produto_nome} ${item.variante_nome && item.variante_nome !== '-' ? `(${item.variante_nome})` : ''}`;
    document.getElementById('movimentoSaldoAtual').textContent = item.saldo_atual;

    const produtoDef = todosOsProdutosCadastrados.find(p => p.id == item.produto_id);
    let skuParaExibir = item.produto_ref_id || 'N/A';
    let imagemSrc = '/img/placeholder-image.png';

    if (produtoDef) {
        if (item.variante_nome && item.variante_nome !== '-' && item.variante_nome !== 'Padrão') {
            const gradeItem = produtoDef.grade?.find(g => g.variacao === item.variante_nome);
            if(gradeItem) {
                 skuParaExibir = gradeItem.sku || skuParaExibir;
                 imagemSrc = gradeItem.imagem || produtoDef.imagem || imagemSrc;
            } else {
                 imagemSrc = produtoDef.imagem || imagemSrc;
            }
        } else {
             skuParaExibir = produtoDef.sku || skuParaExibir;
             imagemSrc = produtoDef.imagem || imagemSrc;
        }
    }
    document.getElementById('movimentoItemSKU').textContent = `SKU: ${skuParaExibir}`;
    document.getElementById('movimentoThumbnail').innerHTML = `<img src="${imagemSrc}" alt="${item.produto_nome}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">`;

    // --- LÓGICA ATUALIZADA DO FORMULÁRIO DE AÇÃO ---
    const qtdInput = document.getElementById('quantidadeMovimentar');
    const qtdLabel = document.getElementById('labelQuantidadeMovimentar');
    const inputTipoOperacaoOculto = document.getElementById('tipoMovimentoSelecionado');
    const containerBotoesTipoOp = document.querySelector('.movimento-tipo-operacao-container');

    // Função interna para atualizar a UI com base no tipo de operação selecionado
    const atualizarCamposPorTipoOperacao = (tipoSelecionado) => {
        if (!inputTipoOperacaoOculto || !containerBotoesTipoOp || !qtdLabel || !qtdInput) return;

        inputTipoOperacaoOculto.value = tipoSelecionado;
        containerBotoesTipoOp.querySelectorAll('.movimento-op-btn').forEach(btn => {
            btn.classList.toggle('ativo', btn.dataset.tipo === tipoSelecionado);
        });

        // Lógica para mudar os textos e valores padrão
        switch (tipoSelecionado) {
            case 'DEVOLUCAO':
                qtdLabel.textContent = 'Quantidade Devolvida:';
                qtdInput.value = ''; // Limpa o campo
                qtdInput.placeholder = 'Ex: 1';
                qtdInput.min = "1"; // Devolução deve ser positiva
                break;
            case 'ENTRADA_MANUAL':
                qtdLabel.textContent = 'Quantidade a Adicionar:';
                qtdInput.value = '';
                qtdInput.placeholder = 'Ex: 10';
                qtdInput.min = "1";
                break;
            case 'SAIDA_MANUAL':
                qtdLabel.textContent = 'Quantidade a Retirar:';
                qtdInput.value = '';
                qtdInput.placeholder = 'Ex: 5';
                qtdInput.min = "1";
                break;
            // O caso 'BALANCO' foi removido do HTML e da lógica
        }
    };
    
    // Reconfigura os listeners dos botões de operação para garantir que estejam limpos
    if (containerBotoesTipoOp) {
        containerBotoesTipoOp.querySelectorAll('.movimento-op-btn').forEach(btn => {
            const newBtn = btn.cloneNode(true);
            btn.parentNode.replaceChild(newBtn, btn);
            newBtn.addEventListener('click', () => atualizarCamposPorTipoOperacao(newBtn.dataset.tipo));
        });
    }

    // Define a operação padrão ao abrir a view
    atualizarCamposPorTipoOperacao('ENTRADA_MANUAL'); 
    
    // Reseta o campo de observação
    document.getElementById('observacaoMovimento').value = '';
    
    // Controla a visibilidade do botão de arquivar
    const btnArquivar = document.getElementById('arquivarItemBtn');
    if(btnArquivar) {
        btnArquivar.style.display = permissoesGlobaisEstoque.includes('arquivar-produto-do-estoque') ? 'inline-flex' : 'none';
    }

    // --- LÓGICA DO HISTÓRICO ---
    const historicoContainer = document.getElementById('historicoContainer');
    // Remove qualquer listener antigo para evitar duplicação
    if (historicoContainer && historicoContainer.listenerEstorno) {
        historicoContainer.removeEventListener('click', historicoContainer.listenerEstorno);
    }

    if (historicoContainer) {
        // Cria a nova função de listener para o estorno
        historicoContainer.listenerEstorno = function(event) {
            const botaoEstorno = event.target.closest('.btn-iniciar-estorno');
            if (botaoEstorno) {
                const movimentoId = parseInt(botaoEstorno.dataset.movimentoId);
                const saldoDoBotao = parseInt(botaoEstorno.dataset.saldoParaEstorno);
                iniciarProcessoDeEstorno(movimentoId, saldoDoBotao, botaoEstorno);
            }
        };
        // Adiciona o novo listener
        historicoContainer.addEventListener('click', historicoContainer.listenerEstorno);
    }

    // Carrega o histórico para o item selecionado
    const historicoBody = document.getElementById('historicoMovimentacoesBody');
    if (historicoBody) {
        historicoBody.innerHTML = `<tr><td colspan="6">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm' })}</td></tr>`;
        carregarHistoricoMovimentacoes(item.produto_id, item.variante_nome, 1);
    }

    // --- NOVA LÓGICA DE CONTROLE DE PERMISSÕES ---
    const btnEntrada = containerBotoesTipoOp.querySelector('[data-tipo="ENTRADA_MANUAL"]');
    const btnSaida = containerBotoesTipoOp.querySelector('[data-tipo="SAIDA_MANUAL"]');
    const btnDevolucao = containerBotoesTipoOp.querySelector('[data-tipo="DEVOLUCAO"]');
    const btnSalvar = document.getElementById('salvarMovimentoBtn');

    // Permissões necessárias
    const podeEntrada = permissoesGlobaisEstoque.includes('registrar-entrada-manual');
    const podeSaida = permissoesGlobaisEstoque.includes('registrar-saida-manual');
    const podeDevolucao = permissoesGlobaisEstoque.includes('registrar-devolucao');

    // Habilita ou desabilita cada botão
    if (btnEntrada) btnEntrada.disabled = !podeEntrada;
    if (btnSaida) btnSaida.disabled = !podeSaida;
    if (btnDevolucao) btnDevolucao.disabled = !podeDevolucao;

    // Lógica para definir a operação padrão e o estado do botão Salvar
    if (podeEntrada) {
        atualizarCamposPorTipoOperacao('ENTRADA_MANUAL');
    } else if (podeSaida) {
        atualizarCamposPorTipoOperacao('SAIDA_MANUAL');
    } else if (podeDevolucao) {
        atualizarCamposPorTipoOperacao('DEVOLUCAO');
    } else {
        // Nenhum botão é permitido, desabilita tudo e mostra mensagem
        if (inputTipoOperacaoOculto) inputTipoOperacaoOculto.value = '';
        containerBotoesTipoOp.querySelectorAll('.movimento-op-btn').forEach(btn => btn.classList.remove('ativo'));
        if (qtdInput) qtdInput.disabled = true;
        mostrarMensagem('Você não tem permissão para realizar nenhuma operação de estoque.', 'aviso');
    }

    // O botão de salvar só fica ativo se o usuário tiver permissão para PELO MENOS UMA operação.
    if (btnSalvar) {
        btnSalvar.disabled = !(podeEntrada || podeSaida || podeDevolucao);
    }
}


async function iniciarProcessoDeEstorno(movimentoId, saldoParaEstorno, botao) {
    if (isNaN(movimentoId) || isNaN(saldoParaEstorno)) {
        mostrarMensagem('Erro: Informações do movimento para estorno estão inválidas.', 'erro');
        return;
    }
    
    // Mostra o popup com o saldo máximo correto
    const quantidadeParaEstornar = await mostrarPopupEstornoParcial(
        `Estornar este movimento.<br>Quantas unidades deseja devolver ao estoque?`,
        saldoParaEstorno
    );

    if (quantidadeParaEstornar === null || quantidadeParaEstornar <= 0) {
        return; 
    }

    botao.disabled = true;
    botao.innerHTML = htmlUICarregando({ variante: 'inline', tamanho: 'sm' });

    try {
        const response = await fetchEstoqueAPI('/estoque/estornar-movimento', {
            method: 'POST',
            body: JSON.stringify({ 
                id_movimento_original: movimentoId,
                quantidade_a_estornar: quantidadeParaEstornar
            })
        });

        const movimentoDeEstorno = response.movimentoDeEstorno;
        if (!movimentoDeEstorno) throw new Error("A API não retornou os dados do estorno.");
        
        mostrarMensagem('Estorno realizado com sucesso!', 'sucesso');
        
        // Atualiza a UI principal
        const itemNoCache = saldosEstoqueGlobaisCompletos.find(item => item.produto_id == movimentoDeEstorno.produto_id && item.variante_nome == (movimentoDeEstorno.variante_nome || '-'));
        if (itemNoCache) {
            itemNoCache.saldo_atual = parseFloat(itemNoCache.saldo_atual) + parseFloat(movimentoDeEstorno.quantidade);
        }
        
        if (itemEstoqueSelecionado && itemEstoqueSelecionado.produto_id == movimentoDeEstorno.produto_id) {
            const saldoAtualEl = document.getElementById('movimentoSaldoAtual');
            if (saldoAtualEl) {
                const novoSaldo = parseInt(saldoAtualEl.textContent) + parseInt(movimentoDeEstorno.quantidade);
                saldoAtualEl.textContent = novoSaldo;
                itemEstoqueSelecionado.saldo_atual = novoSaldo;
            }
            // AQUI ESTÁ A CORREÇÃO:
            // Recarrega o histórico usando o ID do item que está em tela.
            carregarHistoricoMovimentacoes(itemEstoqueSelecionado.produto_id, itemEstoqueSelecionado.variante_nome, currentPageHistorico);
        }

    } catch (error) {
        mostrarMensagem(`Falha no estorno: ${error.data?.details || error.message}`, 'erro');
    } finally {
        // Garante que o botão seja reabilitado, mesmo que esteja em outra "página" do histórico
        const btnOriginal = document.querySelector(`.btn-iniciar-estorno[data-movimento-id="${movimentoId}"]`);
        if(btnOriginal) {
            btnOriginal.disabled = false;
            btnOriginal.innerHTML = '<i class="fas fa-undo"></i>';
        }
    }
}

// Popup para solicitar a quantidade de estorno parcial
function mostrarPopupEstornoParcial(mensagem, quantidadeMaxima) {
    return new Promise((resolve) => {
        // Remove qualquer popup de confirmação existente para evitar duplicação
        const popupExistente = document.getElementById('popup-confirmacao-estoque');
        if (popupExistente) popupExistente.parentElement.remove();

        const container = document.createElement('div');
        container.id = 'popup-confirmacao-estoque';

        const popup = document.createElement('div');
        popup.className = `es-popup-mensagem popup-aviso`; // Usando o estilo de aviso
        
        const overlay = document.createElement('div');
        overlay.className = 'es-popup-overlay';

        const p = document.createElement('p');
        p.innerHTML = mensagem;
        popup.appendChild(p);
        
        // --- Input para a quantidade ---
        const inputContainer = document.createElement('div');
        inputContainer.style.margin = '15px 0';
        const input = document.createElement('input');
        input.type = 'number';
        input.className = 'es-input'; // Reutilizando o estilo de input
        input.placeholder = `Máx: ${quantidadeMaxima}`;
        input.max = quantidadeMaxima;
        input.min = 1;
        input.value = '';
        input.style.textAlign = 'center';
        input.style.width = '120px';
        input.style.fontSize = '1.2rem';
        inputContainer.appendChild(input);
        popup.appendChild(inputContainer);

        const botoesContainer = document.createElement('div');
        botoesContainer.style.display = 'flex';
        botoesContainer.style.gap = '10px';
        botoesContainer.style.justifyContent = 'center';

        const fecharEResolver = (valor) => {
            document.body.removeChild(container);
            resolve(valor);
        };

        const btnConfirmar = document.createElement('button');
        btnConfirmar.textContent = 'Confirmar Estorno';
        btnConfirmar.className = 'es-btn-confirmar';
        btnConfirmar.onclick = () => {
            const qtd = parseInt(input.value);
            if (isNaN(qtd) || qtd <= 0 || qtd > quantidadeMaxima) {
                // Simples alerta para validação
                alert(`Por favor, insira uma quantidade válida entre 1 e ${quantidadeMaxima}.`);
                return;
            }
            fecharEResolver(qtd); // Resolve a promise com a quantidade
        };

        const btnCancelar = document.createElement('button');
        btnCancelar.textContent = 'Cancelar';
        btnCancelar.className = 'es-btn-cancelar';
        btnCancelar.onclick = () => fecharEResolver(null); // Resolve como nulo se cancelar
        
        botoesContainer.appendChild(btnCancelar);
        botoesContainer.appendChild(btnConfirmar);
        popup.appendChild(botoesContainer);

        container.appendChild(overlay);
        container.appendChild(popup);
        document.body.appendChild(container);
        
        input.focus(); // Foco automático no input
    });
}

// Função para arquivar um item de estoque (ATUALIZADA)
async function arquivarItemEstoque() {
    // 1. Validação inicial
    if (!itemEstoqueSelecionado || !itemEstoqueSelecionado.produto_ref_id) {
        console.error("[arquivarItemEstoque] Tentativa de arquivar sem um item selecionado ou sem produto_ref_id.", itemEstoqueSelecionado);
        mostrarMensagem('Nenhum item válido selecionado para arquivar.', 'erro');
        return;
    }

    const skuParaArquivar = itemEstoqueSelecionado.produto_ref_id;
    console.log(`[arquivarItemEstoque] SKU a ser arquivado: ${skuParaArquivar}`);

    // 2. Confirmação do usuário
    const mensagemConfirmacao = `Tem certeza que deseja arquivar o item <br><b>"${itemEstoqueSelecionado.produto_nome} - ${itemEstoqueSelecionado.variante_nome}"</b> (SKU: ${skuParaArquivar})?<br><br>Esta ação irá removê-lo da lista de estoque se o saldo for zero.`;

    const confirmado = await mostrarConfirmacao(mensagemConfirmacao, 'perigo');

    if (!confirmado) {
        console.log("[arquivarItemEstoque] Arquivamento cancelado pelo usuário.");
        return; 
    }

    // 3. Feedback visual e chamada da API
    const btnArquivar = document.getElementById('arquivarItemBtn');
    if(btnArquivar) {
        btnArquivar.disabled = true;
        btnArquivar.innerHTML = htmlUICarregando({ variante: 'inline', tamanho: 'sm' });
    }

    try {
        console.log(`[arquivarItemEstoque] Enviando requisição para API /estoque/arquivar-item com SKU: ${skuParaArquivar}`);
        
        await fetchEstoqueAPI('/estoque/arquivar-item', {
            method: 'POST',
            body: JSON.stringify({ produto_ref_id: skuParaArquivar })
        });
        
        mostrarMensagem('Item arquivado com sucesso!', 'sucesso');

        // Força a recarga da lista principal ao voltar para refletir a mudança
        saldosEstoqueGlobaisCompletos = []; 
        window.location.hash = '#'; // Volta para a tela principal

    } catch (error) {
        console.error('[arquivarItemEstoque] Erro ao arquivar:', error);
        mostrarMensagem(error.data?.details || error.data?.error || error.message || 'Erro ao arquivar o item.', 'erro');
    } finally {
        if(btnArquivar) {
            btnArquivar.disabled = false;
            btnArquivar.innerHTML = '<i class="fas fa-archive"></i>';
        }
    }
}



async function salvarMovimentoManualEstoque() {
    // AJUSTADO para usar itemEstoqueSelecionado e novos IDs
    if (!itemEstoqueSelecionado) {
        mostrarMensagem('Nenhum item selecionado para edição.', 'erro');
        return;
    }

    const tipoOperacao = document.getElementById('tipoMovimentoSelecionado').value;
    const quantidadeStr = document.getElementById('quantidadeMovimentar').value;
    const observacao = document.getElementById('observacaoMovimento').value;

    if (tipoOperacao === '') {
        mostrarMensagem('Selecione um tipo de operação (+, - ou =).', 'aviso');
        return;
    }
    if (quantidadeStr.trim() === '') {
        mostrarMensagem('O campo de quantidade é obrigatório.', 'aviso');
        return;
    }
    const quantidade = parseInt(quantidadeStr);

    if (isNaN(quantidade)) {
        mostrarMensagem('Quantidade deve ser um número.', 'aviso');
        return;
    }
    if ((tipoOperacao === 'ENTRADA_MANUAL' || tipoOperacao === 'SAIDA_MANUAL') && quantidade <= 0) {
        mostrarMensagem('Quantidade para entrada/saída manual deve ser maior que zero.', 'aviso');
        return;
    }
    if (tipoOperacao === 'BALANCO' && quantidade < 0) {
        mostrarMensagem('Quantidade para balanço não pode ser negativa.', 'aviso');
        return;
    }

    const payload = {
        produto_id: itemEstoqueSelecionado.produto_id,
        variante_nome: (itemEstoqueSelecionado.variante_nome === '-' || !itemEstoqueSelecionado.variante_nome) ? null : itemEstoqueSelecionado.variante_nome,        quantidade_movimentada: quantidade,
        tipo_operacao: tipoOperacao,
        observacao: observacao
    };

    const salvarBtn = document.getElementById('salvarMovimentoBtn');
    const originalSalvarBtnText = salvarBtn.innerHTML;
    salvarBtn.disabled = true;
    salvarBtn.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Salvando...`;

    try {
        const resultado = await fetchEstoqueAPI('/estoque/movimento-manual', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        mostrarMensagem(resultado.message || 'Movimento de estoque salvo com sucesso!', 'sucesso');
        
        // Invalida caches para forçar recarga dos dados
        saldosEstoqueGlobaisCompletos = [];
        niveisEstoqueAlertaCache = [];
        invalidateCache('produtos');

        filtroAlertaAtivo = null;
        const searchInput = document.getElementById('searchEstoque');
        if(searchInput) searchInput.value = '';
        currentPageEstoqueTabela = 1;
        
        window.location.hash = '#'; // Volta para a tela principal

    } catch (error) {
        console.error('[salvarMovimentoManualEstoque] Erro ao salvar:', error);
        mostrarMensagem(error.data?.details || error.message || 'Erro desconhecido ao salvar movimento.', 'erro');
    } finally {
        salvarBtn.disabled = false;
        salvarBtn.innerHTML = originalSalvarBtnText;
    }
}

// --- LÓGICA DE ROTEAMENTO (HASHCHANGE) ---
function handleHashChangeEstoque() {
    if (typeof limparListenerRodape === 'function') {
        limparListenerRodape();
        limparListenerRodape = null; // Reseta a variável para a próxima vez
    }

    const mainView = document.getElementById('mainViewEstoque');
    const movimentoView = document.getElementById('editarEstoqueMovimentoView');
    const separacaoView = document.getElementById('separacaoView');
    const inventarioView = document.getElementById('inventarioView'); // <<< NOVO

    if (!mainView || !movimentoView || !separacaoView || !inventarioView) { // <<< NOVO
        console.error("[handleHashChangeEstoque] Uma ou mais views não encontradas.");
        return;
    }

    // Oculta todas as views principais, incluindo a nova
    mainView.style.display = 'none'; mainView.classList.remove('hidden');
    movimentoView.style.display = 'none'; movimentoView.classList.remove('hidden');
    separacaoView.style.display = 'none'; separacaoView.classList.remove('hidden');
    inventarioView.style.display = 'none'; inventarioView.classList.remove('hidden'); // <<< NOVO

    const hash = window.location.hash;

    if (hash.startsWith('#inventario')) {
    inventarioView.style.display = 'block';

    adicionarBotaoFechar(inventarioView, () => { window.location.hash = '#'; });
    
    // Rota para a tela de contagem de uma sessão específica
    if (hash.includes('/contagem/')) {
        const idSessao = hash.split('/contagem/')[1];
        mostrarTelaDeContagem(idSessao); // Função que vamos criar
    } 
    // Rota para a home do inventário
    else {
        prepararViewInventario();
    }
}
    // Rota para a nova view de movimento
    else if (hash === '#editar-estoque-movimento') {
        if (!itemEstoqueSelecionado) {
            console.warn("Tentativa de acessar #editar-estoque-movimento sem um item selecionado. Redirecionando.");
            window.location.hash = ''; // Volta para a lista
            return;
        }
        movimentoView.style.display = 'block';
        adicionarBotaoFechar(movimentoView, () => { window.location.hash = '#'; });
        prepararViewMovimento(); // Prepara e preenche a view
    } 
    // Rota padrão (lista de estoque)
    else {
        mainView.style.display = 'block';
        itemEstoqueSelecionado = null; // Limpa o item selecionado ao voltar para a lista

        const searchTermAtual = document.getElementById('searchEstoque')?.value || '';
        
        // Sempre que voltamos para a lista, é uma boa prática recarregar os dados
        // para refletir quaisquer mudanças feitas.
        const tbodyEstoque = document.getElementById('estoqueTableBody');
        if (tbodyEstoque) tbodyEstoque.innerHTML = `<tr><td colspan="4">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm', texto: 'Atualizando lista...' })}</td></tr>`;
        
        carregarTabelaEstoque(searchTermAtual, currentPageEstoqueTabela).catch(err => {
            console.error("Erro ao recarregar tabela de estoque via handleHashChange:", err);
            mostrarMensagem("Falha ao atualizar tabela de estoque.", "erro");
        });
    }
}

// --- LÓGICA PARA GERENCIAR ITENS ARQUIVADOS ---

async function abrirModalArquivados() {
    const modal = document.getElementById('modalItensArquivados');
    if (!modal) return;
    
    const tbody = document.getElementById('tabelaItensArquivadosBody');
    if(tbody) tbody.innerHTML = `<tr><td colspan="4">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm', texto: 'Carregando...' })}</td></tr>`;
    
    modal.style.display = 'flex';
    adicionarBotaoFechar(modal, fecharModalArquivados);
    await carregarItensArquivados();
}

function fecharModalArquivados() {
    const modal = document.getElementById('modalItensArquivados');
    if (modal) modal.style.display = 'none';
}

async function carregarItensArquivados() {
    try {
        const itensArquivados = await fetchEstoqueAPI('/estoque/arquivados');
        renderizarTabelaArquivados(itensArquivados);
    } catch (error) {
        const tbody = document.getElementById('tabelaItensArquivadosBody');
        if(tbody) tbody.innerHTML = '<tr><td colspan="4" style="text-align:center; color:red;">Erro ao carregar itens arquivados.</td></tr>';
        mostrarMensagem('Falha ao carregar a lista de itens arquivados.', 'erro');
    }
}

function renderizarTabelaArquivados(itens) {
    const tbody = document.getElementById('tabelaItensArquivadosBody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!itens || itens.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4">${htmlUIFeedbackNotFound({
            icon: 'fa-box-archive',
            titulo: 'Nenhum item arquivado',
            mensagem: 'Os itens arquivados aparecerão aqui.',
        })}</td></tr>`;
        return;
    }

    itens.forEach(item => {
        const tr = tbody.insertRow();
        
        // Agora usamos a coluna 'imagem' unificada que vem da API
        const imagemSrc = item.imagem || '/img/placeholder-image.png';

        tr.innerHTML = `
            <td><img src="${imagemSrc}" class="thumbnail" style="width:45px; height:45px; object-fit:cover;" onerror="this.onerror=null;this.src='/img/placeholder-image.png';"></td>
            <td><strong>${item.produto_nome}</strong><br><small>${item.variante_nome}</small></td>
            <td>${item.produto_ref_id}</td>
            <td style="text-align: center;">
                <button class="gs-btn gs-btn-sucesso btn-restaurar-item" data-sku="${item.produto_ref_id}" data-nome="${item.produto_nome} - ${item.variante_nome}">
                    <i class="fas fa-undo-alt"></i> Restaurar
                </button>
            </td>
        `;
    });
}

async function handleRestaurarItemClick(event) {
    const targetButton = event.target.closest('.btn-restaurar-item');
    if (!targetButton) return;

    const sku = targetButton.dataset.sku;
    const nome = targetButton.dataset.nome;

    const confirmado = await mostrarConfirmacao(`Tem certeza que deseja restaurar o item <br><b>${nome}</b> (SKU: ${sku})?<br><br>Ele voltará a aparecer na lista principal de estoque.`);
    
    if (!confirmado) return;

    targetButton.disabled = true;
    targetButton.innerHTML = htmlUICarregando({ variante: 'inline', tamanho: 'sm' });

    try {
        await fetchEstoqueAPI(`/estoque/arquivados/${sku}`, { method: 'DELETE' });
        
        mostrarMensagem('Item restaurado com sucesso!', 'sucesso');
        
        // Remove a linha da tabela do modal para feedback imediato
        targetButton.closest('tr').remove();

        // Força a recarga da lista principal da próxima vez que for visualizada
        saldosEstoqueGlobaisCompletos = [];

    } catch (error) {
        mostrarMensagem(error.data?.error || 'Erro ao restaurar o item.', 'erro');
        targetButton.disabled = false;
        targetButton.innerHTML = '<i class="fas fa-undo-alt"></i> Restaurar';
    }
}


// --- LÓGICA DO HISTÓRICO DE MOVIMENTAÇÕES (Agora em um Modal) ---

// NOVO: Funções para controlar o modal de histórico
function abrirModalHistorico() {
    if (!itemEstoqueSelecionado) return;
    
    const tbodyHistorico = document.getElementById('historicoMovimentacoesTableBody');
    const paginacaoHistorico = document.getElementById('paginacaoHistoricoMovimentacoes');
    
    if(tbodyHistorico) tbodyHistorico.innerHTML = `<tr><td colspan="5">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm', texto: 'Carregando...' })}</td></tr>`;
    if(paginacaoHistorico) paginacaoHistorico.style.display = 'none';

    if (modalHistoricoElement) modalHistoricoElement.style.display = 'flex';
    
    carregarHistoricoMovimentacoes(itemEstoqueSelecionado.produto_nome, itemEstoqueSelecionado.variante_nome, 1);
}

function fecharModalHistorico() {
    if (modalHistoricoElement) modalHistoricoElement.style.display = 'none';
}

async function carregarHistoricoMovimentacoes(produtoId, varianteNome, page) {
    currentPageHistorico = page;
    const tbody = document.getElementById('historicoMovimentacoesBody');
    const paginacaoContainer = document.getElementById('paginacaoHistoricoMovimentacoes');
    if (!tbody || !paginacaoContainer) return;

    tbody.innerHTML = `<tr><td colspan="6">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm', texto: 'Carregando...' })}</td></tr>`;
    paginacaoContainer.innerHTML = '';

    try {
        // AQUI ESTÁ A CORREÇÃO:
        // Montamos os parâmetros da URL com 'produto_id'
        const params = new URLSearchParams({
            produto_id: produtoId,
            limit: itemsPerPageHistorico,
            page: currentPageHistorico
        });
        
        // A API de movimentos agora também precisa do nome da variante
        if (varianteNome && varianteNome !== '-') {
            params.append('variante_nome', varianteNome);
        }

        const data = await fetchEstoqueAPI(`/estoque/movimentos?${params.toString()}`);
        
        renderizarHistoricoMovimentacoes(data.rows || []);
        renderizarPaginacaoHistorico(data.pages || 0, produtoId, varianteNome); // Passa o ID para a paginação
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;">Erro ao carregar histórico.</td></tr>`;
        mostrarMensagem('Erro ao carregar histórico de movimentações.', 'erro');
    }
}

function renderizarHistoricoMovimentacoes(movimentos) {
    const tbody = document.getElementById('historicoMovimentacoesBody');
    if (!tbody) {
        console.error("Elemento #historicoMovimentacoesBody não encontrado para renderizar histórico.");
        return;
    }
    tbody.innerHTML = '';

    if (!movimentos || movimentos.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">${htmlUIFeedbackNotFound({
            icon: 'fa-arrow-right-arrow-left',
            titulo: 'Nenhuma movimentação encontrada',
            mensagem: 'Não há movimentações para exibir.',
        })}</td></tr>`;
        return;
    }
    
    movimentos.forEach(mov => {
        const tr = tbody.insertRow();
        const quantidadeClasse = mov.quantidade > 0 ? 'quantidade-entrada' : 'quantidade-saida';

        // Adiciona classe para destacar a linha se for um estorno (para o visual que já temos)
        if (mov.tipo_movimento.includes('ESTORNO')) {
            tr.classList.add('linha-estorno');
        }

        tr.innerHTML = `
            <td data-label="Data">${new Date(mov.data_movimento).toLocaleString('pt-BR')}</td>
            <td data-label="Tipo">${mov.tipo_movimento.replace(/_/g, ' ')}</td>
            <td data-label="Quantidade" class="${quantidadeClasse}" style="text-align:right;">${mov.quantidade > 0 ? '+' : ''}${mov.quantidade}</td>
            <td data-label="Usuário">${mov.usuario_responsavel || '-'}</td>
            <td data-label="Observação">${mov.observacao || '-'}</td>
            <td data-label="Ações" style="text-align:center;"></td>
        `;

        // --- LÓGICA DE ESTORNO APRIMORADA ---
        
        // 1. Calcula o saldo disponível para estorno neste movimento específico.
        const quantidadeOriginalAbs = Math.abs(mov.quantidade);
        const quantidadeJaEstornada = mov.quantidade_estornada || 0;
        const saldoDisponivelParaEstorno = quantidadeOriginalAbs - quantidadeJaEstornada;
        
        // 2. Mostra o total já estornado, se for maior que zero (para feedback).
        if (mov.quantidade < 0 && quantidadeJaEstornada > 0) {
            const estornadoInfo = document.createElement('span');
            estornadoInfo.className = 'info-estornado'; // Estilize esta classe se desejar
            estornadoInfo.textContent = `(estornado: ${quantidadeJaEstornada})`;
            estornadoInfo.style.display = 'block'; // Para quebrar a linha
            estornadoInfo.style.fontSize = '0.8em';
            estornadoInfo.style.color = '#7f8c8d';
            tr.cells[2].appendChild(estornadoInfo);
        }
        
        // 3. Define as condições para mostrar o botão de estorno.
        const podeEstornar = 
            mov.quantidade < 0 &&                               // É uma saída
            saldoDisponivelParaEstorno > 0 &&                   // Ainda tem saldo para estornar
            !mov.tipo_movimento.startsWith('ESTORNO_') &&       // NÃO é um estorno
            permissoesGlobaisEstoque.includes('gerenciar-estoque'); // Tem permissão

        // 4. Se todas as condições forem verdadeiras, cria e adiciona o botão.
        if (podeEstornar) {
            const cellAcoes = tr.cells[5];
            const btnEstornar = document.createElement('button');
            btnEstornar.className = 'es-btn-icon-estorno btn-iniciar-estorno';
            btnEstornar.title = `Estornar até ${saldoDisponivelParaEstorno} unidades`;
            btnEstornar.innerHTML = '<i class="fas fa-undo"></i>';
            btnEstornar.dataset.movimentoId = mov.id;
            // Armazena o SALDO REAL disponível para estorno no botão
            btnEstornar.dataset.saldoParaEstorno = saldoDisponivelParaEstorno;
            cellAcoes.appendChild(btnEstornar);
        }
    });
}


function renderizarPaginacaoHistorico(totalPages, produtoId, varianteNome) {
    const paginacaoContainer = document.getElementById('paginacaoHistoricoMovimentacoes');
    paginacaoContainer.innerHTML = '';
    if (totalPages <= 1) {
        paginacaoContainer.style.display = 'none';
        return;
    }
    paginacaoContainer.style.display = 'flex';

    paginacaoContainer.innerHTML = `
        <button class="pagination-btn es-btn" data-page="${Math.max(1, currentPageHistorico - 1)}" ${currentPageHistorico === 1 ? 'disabled' : ''}>Anterior</button>
        <span class="pagination-current">Pág. ${currentPageHistorico} de ${totalPages}</span>
        <button class="pagination-btn es-btn" data-page="${Math.min(totalPages, currentPageHistorico + 1)}" ${currentPageHistorico === totalPages ? 'disabled' : ''}>Próximo</button>
    `;

    paginacaoContainer.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetPage = parseInt(btn.dataset.page);
            // AQUI ESTÁ A CORREÇÃO: A chamada recursiva usa o ID
            carregarHistoricoMovimentacoes(produtoId, varianteNome, targetPage);
        });
    });
}

// =========================================================================
// ### INÍCIO - MÓDULO DE SEPARAÇÃO DE PEDIDOS (PICKING) ###
// =========================================================================

function mostrarViewSeparacao() {
    document.getElementById('mainViewEstoque').style.display = 'none';
    document.getElementById('editarEstoqueMovimentoView').style.display = 'none';
    document.getElementById('separacaoDetalheView').style.display = 'none'; // Esconde a nova tela de detalhe
    
    const separacaoView = document.getElementById('separacaoView');
    separacaoView.classList.remove('hidden');
    separacaoView.style.display = 'block';

    adicionarBotaoFechar(separacaoView, voltarParaEstoquePrincipal);

    // Limpa a busca e renderiza os produtos base
    document.getElementById('searchSeparacaoProdutoBase').value = '';
    renderizarProdutosBase();
}

function renderizarProdutosBase() {
    const container = document.getElementById('separacaoProdutosBaseContainer');
    const termoBusca = document.getElementById('searchSeparacaoProdutoBase').value.toLowerCase();
    container.innerHTML = '';

    // Lógica para agrupar produtos (sem alteração)
    const produtosBase = saldosEstoqueGlobaisCompletos.reduce((acc, item) => {
        if (!acc[item.produto_nome]) {
            acc[item.produto_nome] = { produto_nome: item.produto_nome, variacoesComEstoque: 0, imagem: null };
        }
        acc[item.produto_nome].variacoesComEstoque++;
        if (!acc[item.produto_nome].imagem) {
            const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === item.produto_nome);
            if (produtoDef) {
                acc[item.produto_nome].imagem = produtoDef.imagem || (produtoDef.grade && produtoDef.grade[0]?.imagem) || '/img/placeholder-image.png';
            }
        }
        return acc;
    }, {});

    let listaProdutosBase = Object.values(produtosBase);
    if (termoBusca) {
        listaProdutosBase = listaProdutosBase.filter(p => p.produto_nome.toLowerCase().includes(termoBusca));
    }
    if (listaProdutosBase.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-box-open',
            titulo: 'Nenhum produto encontrado',
            mensagem: 'Não há produtos correspondentes à busca.',
        });
        return;
    }

    listaProdutosBase.forEach(produto => {
        const card = document.createElement('div');
        card.className = 'es-produto-base-card';
        // Usando data-attributes para passar a informação
        card.dataset.nomeProduto = produto.produto_nome;
        card.innerHTML = `
            <img src="${produto.imagem || '/img/placeholder-image.png'}" alt="${produto.produto_nome}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
            <div class="es-produto-base-card-info">
                <h3>${produto.produto_nome}</h3>
                <p>${produto.variacoesComEstoque} variações com estoque</p>
            </div>
        `;
        container.appendChild(card);
    });

    // Removendo o listener antigo do container se existir
    const novoContainer = container.cloneNode(true);
    container.parentNode.replaceChild(novoContainer, container);
    
    // Adicionando um ÚNICO listener ao container pai (Delegação de Eventos)
    novoContainer.addEventListener('click', function(event) {
        // Encontra o card mais próximo que foi clicado
        const cardClicado = event.target.closest('.es-produto-base-card');
        if (cardClicado) {
            const nomeProduto = cardClicado.dataset.nomeProduto;
            if (nomeProduto) {
                console.log(`Card clicado: ${nomeProduto}`);
                mostrarViewDetalheSeparacao(nomeProduto);
            }
        }
    });
}

function mostrarViewDetalheSeparacao(nomeProduto) {
    produtoEmDetalheSeparacao = nomeProduto;

    document.getElementById('separacaoView').style.display = 'none';

    const detalheView = document.getElementById('separacaoDetalheView');
    detalheView.classList.remove('hidden');
    detalheView.style.display = 'block';

    // Adiciona o botão "X" que chama a função de voltar para a lista de produtos
    adicionarBotaoFechar(detalheView, voltarParaListaProdutos);

    document.getElementById('detalheSeparacaoTitulo').textContent = `Separando: ${nomeProduto}`;
    
    // Carrega os filtros e os cards de variação para este produto
    renderizarFiltrosDeVariacao(nomeProduto);
    renderizarCardsDeVariacao(nomeProduto);
}


function voltarParaListaProdutos() {
    produtoEmDetalheSeparacao = null;
    document.getElementById('separacaoDetalheView').style.display = 'none';
    document.getElementById('separacaoView').style.display = 'block';
    // Não precisa recarregar, pois a lista de produtos base não mudou
}

function voltarParaEstoquePrincipal() {
    if (itensEmSeparacao.size > 0) {
        mostrarConfirmacao('Você tem itens no carrinho de separação.<br>Deseja descartá-los e voltar?', 'aviso')
            .then(confirmado => {
                if (confirmado) {
                    itensEmSeparacao.clear();
                    atualizarCarrinhoFlutuante(); // Garante que a UI do carrinho seja atualizada
                    document.getElementById('mainViewEstoque').style.display = 'block';
                    document.getElementById('separacaoView').style.display = 'none';
                    document.getElementById('separacaoDetalheView').style.display = 'none';
                }
            });
    } else {
        document.getElementById('mainViewEstoque').style.display = 'block';
        document.getElementById('separacaoView').style.display = 'none';
        document.getElementById('separacaoDetalheView').style.display = 'none';
        document.getElementById('carrinhoSeparacao').classList.add('hidden');

    }
}


function renderizarCardsDeVariacao() {
    const container = document.getElementById('separacaoVariacoesCardsContainer');
    const nomeProduto = produtoEmDetalheSeparacao;
    if (!nomeProduto) return;
    
    container.innerHTML = '';
    
    const filtrosSelecionados = {};
    const produtoDefFiltro = todosOsProdutosCadastrados.find(p => p.nome === nomeProduto);
    if(produtoDefFiltro && produtoDefFiltro.variacoes) {
        produtoDefFiltro.variacoes.forEach(variacaoDef => {
            const selectFiltro = document.getElementById(`filtro-${variacaoDef.chave}`);
            if (selectFiltro && selectFiltro.value) {
                const index = produtoDefFiltro.variacoes.findIndex(v => v.chave === variacaoDef.chave);
                filtrosSelecionados[index] = selectFiltro.value;
            }
        });
    }

    let variacoesDoProduto = saldosEstoqueGlobaisCompletos.filter(item => item.produto_nome === nomeProduto);
    
    if (Object.keys(filtrosSelecionados).length > 0) {
        variacoesDoProduto = variacoesDoProduto.filter(item => {
            const partesVariacao = item.variante_nome.split(' | ').map(p => p.trim());
            return Object.entries(filtrosSelecionados).every(([indexFiltro, valorFiltro]) => {
                return partesVariacao[parseInt(indexFiltro)] === valorFiltro;
            });
        });
    }
    
    if (variacoesDoProduto.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-sliders',
            titulo: 'Nenhuma variação encontrada',
            mensagem: 'Não há variações correspondentes aos filtros selecionados.',
        });
        return;
    }

    variacoesDoProduto.forEach(item => {
        const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === item.produto_nome);
        let imagemSrc = '/img/placeholder-image.png';
        if (produtoDef && item.variante_nome && item.variante_nome !== '-') {
            const gradeItem = produtoDef.grade?.find(g => g.variacao === item.variante_nome);
            imagemSrc = gradeItem?.imagem || produtoDef.imagem || '/img/placeholder-image.png';
        }

        const card = document.createElement('div');
        card.className = 'es-separacao-card';
        card.dataset.produtoRefId = item.produto_ref_id;

        const saldoInicial = parseInt(item.saldo_atual);
        const quantidadeNoCarrinho = itensEmSeparacao.get(item.produto_ref_id)?.quantidade_movimentada || 0;
        const saldoProjetado = saldoInicial - quantidadeNoCarrinho;

        if (quantidadeNoCarrinho > 0) {
            card.classList.add('selecionado');
        }
        
        card.innerHTML = `
            <div class="es-separacao-card-header">
                <img src="${imagemSrc}" alt="${item.variante_nome}" class="es-separacao-card-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
                <div class="es-separacao-card-info">
                    <h3>${item.variante_nome || 'Padrão'}</h3>
                    <p>SKU: ${item.produto_ref_id || 'N/A'}</p>
                </div>
            </div>
            <div class="es-separacao-card-body">
                <div class="es-separacao-card-saldo">
                    Estoque: <strong class="saldo-display" style="color: ${quantidadeNoCarrinho > 0 ? '#e74c3c' : 'var(--gs-primaria)'};">${saldoProjetado}</strong>
                </div>
                <div class="es-separacao-card-controls">
                    <button class="control-btn minus-btn">-</button>
                    <input type="number" class="qty-input" value="${quantidadeNoCarrinho}" min="0" max="${saldoInicial}">
                    <button class="control-btn plus-btn">+</button>
                </div>
            </div>
        `;
        
        const qtyInput = card.querySelector('.qty-input');
        const plusBtn = card.querySelector('.plus-btn');
        const minusBtn = card.querySelector('.minus-btn');
        const saldoDisplay = card.querySelector('.saldo-display');

        const atualizarItem = (novaQtd) => {
            let qtdFinal = Math.max(0, Math.min(novaQtd, saldoInicial));
            qtyInput.value = qtdFinal;
            
            saldoDisplay.textContent = saldoInicial - qtdFinal;

            if (qtdFinal > 0) {
                // CORREÇÃO: Garante que o ID e o NOME sejam salvos no carrinho
                itensEmSeparacao.set(item.produto_ref_id, { 
                    produto_id: item.produto_id, 
                    produto_nome: item.produto_nome, 
                    variante_nome: item.variante_nome, 
                    quantidade_movimentada: qtdFinal 
                });
                card.classList.add('selecionado');
                saldoDisplay.style.color = '#e74c3c';
            } else {
                itensEmSeparacao.delete(item.produto_ref_id);
                card.classList.remove('selecionado');
                saldoDisplay.style.color = 'var(--gs-primaria)';
            }
            atualizarCarrinhoFlutuante();
        };

        plusBtn.addEventListener('click', () => atualizarItem(parseInt(qtyInput.value) + 1));
        minusBtn.addEventListener('click', () => atualizarItem(parseInt(qtyInput.value) - 1));
        qtyInput.addEventListener('change', () => atualizarItem(parseInt(qtyInput.value)));
        container.appendChild(card);
    });
}


function renderizarFiltrosDeVariacao(nomeProduto) {
    const container = document.getElementById('filtrosVariacaoContainer');
    container.innerHTML = '';
    const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === nomeProduto);
    if (!produtoDef || !produtoDef.variacoes || produtoDef.variacoes.length === 0) return;

    produtoDef.variacoes.forEach(variacao => {
        const formGrupo = document.createElement('div');
        formGrupo.className = 'es-form-grupo';
        const label = document.createElement('label');
        label.textContent = variacao.chave;
        label.htmlFor = `filtro-${variacao.chave}`;
        const select = document.createElement('select');
        select.className = 'es-select';
        select.id = `filtro-${variacao.chave}`;
        select.dataset.chave = variacao.chave;
        
        // MUDANÇA AQUI: Usa a nova função para o texto
        select.innerHTML = `<option value="">${getLabelFiltro(variacao.chave)}</option>`; 
        
        const valoresUnicos = variacao.valores.split(',').map(v => v.trim()).filter(Boolean);
        valoresUnicos.forEach(valor => {
            select.innerHTML += `<option value="${valor}">${valor}</option>`;
        });
        select.onchange = () => renderizarCardsDeVariacao();
        formGrupo.appendChild(label);
        formGrupo.appendChild(select);
        container.appendChild(formGrupo);
    });
}

function atualizarCarrinhoFlutuante() {
    const carrinhoBtn = document.getElementById('carrinhoSeparacao');
    const badge = document.getElementById('carrinhoContadorBadge');
    
    if (!carrinhoBtn || !badge) return; // Verificação de segurança

    const numeroDeItens = itensEmSeparacao.size;

    if (numeroDeItens > 0) {
        badge.textContent = numeroDeItens;
        badge.classList.remove('hidden'); // Mostra o badge
        carrinhoBtn.classList.remove('hidden'); // Mostra o botão principal
    } else {
        carrinhoBtn.classList.add('hidden'); // Esconde o botão principal
        badge.classList.add('hidden'); // Garante que o badge também seja escondido
    }
}

function abrirModalFinalizacao() {
    console.log(`[abrirModalFinalizacao] Chamada. Itens no carrinho: ${itensEmSeparacao.size}`);
    
    // Pega as referências dos elementos
    const modal = document.getElementById('modalFinalizarSeparacao');
    const corpoTabela = document.getElementById('resumoCarrinhoBody'); 
    const canalVendaContainer = document.getElementById('canalVendaContainer');
    const canalVendaInput = document.getElementById('canalVendaSelecionado');
    const inputObs = document.getElementById('observacaoSaida');
    const btnConfirmar = document.getElementById('btnConfirmarSaidaEstoque');

    // Validação robusta dos elementos
    if (!modal || !corpoTabela || !canalVendaContainer || !btnConfirmar) {
        console.error("Erro fatal: Elementos do modal de finalização não encontrados. Verifique os IDs no HTML.");
        mostrarMensagem("Erro ao abrir janela de finalização (E-01).", "erro");
        return;
    }

    // --- Reset do estado do modal ---
    corpoTabela.innerHTML = ''; // Limpa a tabela
    canalVendaContainer.innerHTML = '';
    canalVendaInput.value = '';
    inputObs.value = '';
    btnConfirmar.disabled = true;

    // --- Populando a tabela de resumo ---
    if (itensEmSeparacao.size === 0) {
        console.log("[abrirModalFinalizacao] Carrinho vazio. Exibindo mensagem.");
        corpoTabela.innerHTML = '<tr><td colspan="3" style="text-align: center; padding: 20px;">O carrinho de separação está vazio.</td></tr>';
    } else {
        console.log("[abrirModalFinalizacao] Populando tabela com itens:", itensEmSeparacao);
        let tabelaHTML = '';
        itensEmSeparacao.forEach((item, refId) => {
            tabelaHTML += `
                <tr>
                    <td colspan="3">
                        <div class="resumo-carrinho-item">
                            <div class="info">
                                <div class="produto-nome">${item.produto_nome}</div>
                                <div class="variante-nome">${item.variante_nome || '-'}</div>
                            </div>
                            <div class="actions">
                                <span class="quantidade">${item.quantidade_movimentada}</span>
                                <button class="remover-item-btn" title="Remover item" data-ref-id="${refId}">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });
        corpoTabela.innerHTML = tabelaHTML;
    }

    // --- Gerando os botões de canal de venda ---
    const canais = [
        { id: 'SAIDA_PEDIDO_SHOPEE', label: 'Shopee' },
        { id: 'SAIDA_PEDIDO_SHEIN', label: 'Shein' },
        { id: 'SAIDA_PEDIDO_MERCADO_LIVRE', label: 'Mercado Livre' },
        { id: 'SAIDA_PEDIDO_PONTO_FISICO', label: 'Ponto Físico', disabled: true }
    ];
    canais.forEach(canal => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'es-btn es-btn-tipo-op';
        btn.dataset.valor = canal.id;
        btn.textContent = canal.label;
        btn.disabled = canal.disabled || false;
        btn.addEventListener('click', () => { // Usando addEventListener por segurança
            canalVendaContainer.querySelectorAll('button').forEach(b => b.classList.remove('ativo'));
            btn.classList.add('ativo');
            canalVendaInput.value = canal.id;
            btnConfirmar.disabled = itensEmSeparacao.size === 0;
        });
        canalVendaContainer.appendChild(btn);
    });

    // Mostra o modal
    modal.style.display = 'flex';
}

function fecharModalFinalizacao() {
    const modal = document.getElementById('modalFinalizarSeparacao');
    modal.style.display = 'none';
}

async function confirmarSaidaEstoque() {
    const tipo_operacao = document.getElementById('canalVendaSelecionado').value;
    const observacao = document.getElementById('observacaoSaida').value;

    if (!tipo_operacao) {
        mostrarMensagem('Selecione um canal de venda para a saída.', 'aviso');
        return;
    }

    // CORREÇÃO: Garante que o payload enviado para a API tenha 'produto_id'
    const itensParaEnviar = Array.from(itensEmSeparacao.values()).map(item => ({
        produto_id: item.produto_id, // Usa o ID salvo no carrinho
        variante_nome: item.variante_nome,
        quantidade_movimentada: item.quantidade_movimentada
    }));

    if (itensParaEnviar.length === 0) { /* ... */ }
    
    const payload = { itens: itensParaEnviar, tipo_operacao, observacao };

    const btnConfirmar = document.getElementById('btnConfirmarSaidaEstoque');
    const originalBtnHTML = btnConfirmar.innerHTML;
    btnConfirmar.disabled = true;
    btnConfirmar.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Registrando...`;

    try {
        await fetchEstoqueAPI('/estoque/movimento-em-lote', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        mostrarMensagem('Saída de estoque registrada com sucesso!', 'sucesso');
        
        // CORREÇÃO 1: Limpa o carrinho e ATUALIZA a interface do carrinho flutuante
        itensEmSeparacao.clear();
        atualizarCarrinhoFlutuante(); // <<< CHAVE: Atualiza a UI do carrinho para 0
        
        fecharModalFinalizacao();
        
        saldosEstoqueGlobaisCompletos = [];
        await carregarTabelaEstoque();
        
        // CORREÇÃO 2: Volta para a tela principal de estoque de forma limpa
        document.getElementById('mainViewEstoque').style.display = 'block';
        document.getElementById('separacaoView').style.display = 'none';
        document.getElementById('separacaoDetalheView').style.display = 'none'; // Garante que a tela de detalhe também seja escondida

    } catch (error) {
        console.error('[confirmarSaidaEstoque] Erro:', error);
        mostrarMensagem(`Falha ao registrar saída: ${error.data?.details || error.message}`, 'erro');
    } finally {
        // Garante que o estado do botão seja resetado em qualquer cenário (sucesso ou falha)
        if (btnConfirmar) {
            btnConfirmar.disabled = false;
            btnConfirmar.innerHTML = originalBtnHTML;
        }
    }
}

// FUNÇÃO para remover itens do modal
window.removerItemDoCarrinho = function(produtoRefId) {
    if (itensEmSeparacao.has(produtoRefId)) {
        itensEmSeparacao.delete(produtoRefId);
        abrirModalFinalizacao(); // Reabre/atualiza o modal com a lista nova
        atualizarCarrinhoFlutuante(); 
        const card = document.querySelector(`.es-separacao-card[data-produto-ref-id="${produtoRefId}"]`);
        if (card) {
            card.classList.remove('selecionado');
            card.querySelector('.qty-input').value = 0;
        }
    }
};


// --- INICIALIZAÇÃO DA PÁGINA E EVENT LISTENERS ---

async function inicializarPaginaEstoque() {
    console.log('[Estoque inicializarPaginaEstoque]');
    
    const overlay = document.getElementById('paginaLoadingOverlay');
    // Mostra o overlay imediatamente
    if(overlay) overlay.classList.remove('hidden');

    // ... (resto da lógica de obter elementos de modal) ...
    modalNiveisElement = document.getElementById('modalConfigurarNiveis');

    try {
        // A busca de dados continua a mesma
        if (todosOsProdutosCadastrados.length === 0) {
            todosOsProdutosCadastrados = await obterProdutos();
        }
        gerarFiltrosDinamicos();
        await carregarTabelaEstoque(); // Esta função agora vai popular tudo

    } catch (error) {
        console.error("[inicializarPaginaEstoque] Erro:", error);
        mostrarMensagem("Falha ao carregar dados do estoque.", "erro");
    } finally {
        // Esconde o overlay DEPOIS que tudo carregou
        if(overlay) overlay.classList.add('hidden');
    }
    
    setupEventListenersEstoque();
    handleHashChangeEstoque(); 
    console.log('[Estoque inicializarPaginaEstoque] Concluído.');
}

// =========================================================================
// ### INÍCIO - MÓDULO DE INVENTÁRIO ###
// =========================================================================

async function prepararViewInventario() {
    console.log('[prepararViewInventario] Preparando a view de inventário...');
    
    // Garante que a tela de contagem esteja oculta e a tela inicial visível
    document.getElementById('inventarioHome').classList.remove('hidden');
    document.getElementById('inventarioContagem').classList.add('hidden');
    
    const historicoBody = document.getElementById('tabelaHistoricoInventarioBody');
    const btnIniciarNovo = document.getElementById('btnIniciarNovoInventario');
    const containerEmAndamento = document.getElementById('containerInventarioEmAndamento');

    // Mostra um spinner enquanto carrega
    historicoBody.innerHTML = `<tr><td colspan="6">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm', texto: 'Carregando histórico...' })}</td></tr>`;
    btnIniciarNovo.disabled = true;
    containerEmAndamento.classList.add('hidden');

    try {
        // Chama a nossa nova API
        const dadosSessoes = await fetchEstoqueAPI('/inventario/sessoes');

        // Lógica para controlar os botões com base na resposta da API
        if (dadosSessoes.sessaoEmAndamento) {
            sessaoInventarioAtiva = dadosSessoes.sessaoEmAndamento;
            btnIniciarNovo.classList.add('hidden'); // Esconde o botão de iniciar novo
            containerEmAndamento.classList.remove('hidden'); // Mostra o de continuar
        } else {
            sessaoInventarioAtiva = null;
            btnIniciarNovo.classList.remove('hidden'); // Mostra o botão de iniciar
            containerEmAndamento.classList.add('hidden'); // Esconde o de continuar
        }
        
        // Renderiza a tabela de histórico
        renderizarHistoricoInventario(dadosSessoes.historico);

    } catch (error) {
        console.error('[prepararViewInventario] Erro ao buscar sessões:', error);
        historicoBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:red;">Falha ao carregar histórico.</td></tr>`;
        mostrarMensagem('Não foi possível carregar os dados do inventário.', 'erro');
    } finally {
        btnIniciarNovo.disabled = false; // Reabilita o botão em qualquer cenário
    }
}

async function iniciarNovoInventario() {
    console.log('[iniciarNovoInventario] Tentando iniciar novo inventário...');
    const btn = document.getElementById('btnIniciarNovoInventario');
    const overlay = document.getElementById('inventarioLoadingOverlay');

    btn.disabled = true;
    btn.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Iniciando...`;
    overlay.classList.remove('hidden');

    try {
        const resultado = await fetchEstoqueAPI('/inventario/iniciar', {
            method: 'POST',
            body: JSON.stringify({ observacoes: 'Inventário iniciado via sistema web.' }) // Podemos adicionar um campo de observação depois
        });

        sessaoInventarioAtiva = resultado.sessao;
        mostrarMensagem(`Novo inventário #${sessaoInventarioAtiva.id} iniciado com ${resultado.totalItens} itens.`, 'sucesso');
        
        window.location.hash = `#inventario/contagem/${sessaoInventarioAtiva.id}`;

    } catch (error) {
        console.error('[iniciarNovoInventario] Erro:', error);
        // A API já retorna um erro 409 se houver um inventário em andamento.
        const mensagem = error.data?.error || error.message || 'Erro desconhecido ao iniciar inventário.';
        mostrarMensagem(mensagem, 'erro');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-plus-circle"></i> Iniciar Novo Inventário';
        overlay.classList.add('hidden');
    }
}

function renderizarHistoricoInventario(sessoes) {
    const tbody = document.getElementById('tabelaHistoricoInventarioBody');
    tbody.innerHTML = '';

    if (!sessoes || sessoes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6">${htmlUIFeedbackNotFound({
            icon: 'fa-clipboard-check',
            titulo: 'Nenhum inventário finalizado',
            mensagem: 'Os inventários concluídos aparecerão aqui.',
        })}</td></tr>`;
        return;
    }

    sessoes.forEach(sessao => {
        const tr = tbody.insertRow();

        let statusClass = '';
        switch (sessao.status.toUpperCase()) {
            case 'FINALIZADO':
                statusClass = 'status-ok'; // Reutilizaremos alguma classe de status existente se possível
                break;
            case 'CANCELADO': // Se um dia implementarmos
                statusClass = 'status-urgente';
                break;
            default:
                statusClass = 'status-baixo';
        }
        
        // Formata as datas para exibição
        const dataInicio = new Date(sessao.data_inicio).toLocaleString('pt-BR');
        const dataFim = sessao.data_fim ? new Date(sessao.data_fim).toLocaleString('pt-BR') : '-';

        tr.innerHTML = `
            <td data-label="ID">#${sessao.id}</td>
            <td data-label="Status"><span class="fila-card-status-badge ${statusClass}">${sessao.status}</span></td>
            <td data-label="Iniciado em">${dataInicio}</td>
            <td data-label="Finalizado em">${dataFim}</td>
            <td data-label="Responsável">${sessao.usuario_responsavel || 'N/A'}</td>
            <td data-label="Ações" style="text-align:center;">
            <button class="gs-btn gs-btn-secundario" onclick="abrirModalDetalhesInventario(${sessao.id})">
                <i class="fas fa-eye"></i> Ver
            </button>
            </td>
        `;
    });
}

async function abrirModalDetalhesInventario(idSessao) {
    const modal = document.getElementById('modalDetalhesInventario');
    const tbody = document.getElementById('tabelaDetalhesInventarioBody');
    
    // Mostra o modal e um spinner
    modal.style.display = 'flex';
    tbody.innerHTML = `<tr><td colspan="4">${htmlUICarregando({ variante: 'bloco', tamanho: 'sm' })}</td></tr>`;
    
    try {
        const dados = await fetchEstoqueAPI(`/inventario/sessoes/${idSessao}`);
        const { sessao, itens } = dados;

        // Preenche o cabeçalho do modal
        document.getElementById('detalhesInventarioTitulo').textContent = `Detalhes do Inventário #${sessao.id}`;
        document.getElementById('detalhesInventarioResponsavel').textContent = sessao.usuario_responsavel;
        document.getElementById('detalhesInventarioInicio').textContent = new Date(sessao.data_inicio).toLocaleString('pt-BR');
        document.getElementById('detalhesInventarioFim').textContent = new Date(sessao.data_fim).toLocaleString('pt-BR');
        
        // Filtra para mostrar apenas itens com divergência
        const itensDivergentes = itens.filter(item => item.quantidade_contada !== null && item.quantidade_contada !== item.quantidade_sistema);

        tbody.innerHTML = ''; // Limpa o spinner
        if (itensDivergentes.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4">${htmlUIFeedbackNotFound({
                icon: 'fa-check-circle',
                titulo: 'Nenhuma divergência encontrada',
                mensagem: 'Este inventário não possui diferenças para ajustar.',
            })}</td></tr>`;
            return;
        }

        itensDivergentes.forEach(item => {
            const tr = tbody.insertRow();
            const diferenca = item.quantidade_contada - item.quantidade_sistema;
            const classeDiferenca = diferenca > 0 ? 'diferenca-positiva' : 'diferenca-negativa';
            const sinal = diferenca > 0 ? '+' : '';

            tr.innerHTML = `
                <td>
                    <strong>${item.produto_nome}</strong><br>
                    <small>${item.variante_nome}</small>
                </td>
                <td style="text-align: center;">${item.quantidade_sistema}</td>
                <td style="text-align: center;">${item.quantidade_contada}</td>
                <td style="text-align: center;" class="${classeDiferenca}">${sinal}${diferenca}</td>
            `;
        });

    } catch (error) {
        console.error('Erro ao buscar detalhes do inventário:', error);
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:red;">Falha ao carregar detalhes.</td></tr>`;
    }
}

function fecharModalDetalhesInventario() {
    document.getElementById('modalDetalhesInventario').style.display = 'none';
}

// Anexa a nova função ao window para que o onclick no HTML funcione
window.abrirModalDetalhesInventario = abrirModalDetalhesInventario;


// Guarda o cache dos itens da sessão atual para evitar buscas repetidas
let itensSessaoInventarioCache = [];

async function mostrarTelaDeContagem(idSessao) {
    console.log(`[mostrarTelaDeContagem] Carregando contagem para sessão #${idSessao}`);

    document.getElementById('inventarioHome').classList.add('hidden');
    document.getElementById('inventarioContagem').classList.remove('hidden');
    
    const container = document.getElementById('inventarioItensContainer');
    const overlay = document.getElementById('inventarioLoadingOverlay');
    overlay.classList.remove('hidden');
    container.innerHTML = htmlUICarregando({ texto: 'Carregando itens...' });

    try {
        // AGORA USANDO A API REAL
        const dadosSessao = await fetchEstoqueAPI(`/inventario/sessoes/${idSessao}`);
        
        sessaoInventarioAtiva = dadosSessao.sessao; // Salva a sessão ativa globalmente
        itensSessaoInventarioCache = dadosSessao.itens; // Salva os itens no cache local

        // Preenche o cabeçalho
        document.getElementById('inventarioSessaoId').textContent = `#${sessaoInventarioAtiva.id}`;
        document.getElementById('inventarioSessaoData').textContent = new Date(sessaoInventarioAtiva.data_inicio).toLocaleDateString('pt-BR');

        // Verifica se algum item na sessão já foi contado
        const temItensContados = itensSessaoInventarioCache.some(item => item.quantidade_contada !== null);
        document.getElementById('btnRevisarInventario').disabled = !temItensContados;

        // Renderiza os itens
        renderizarItensDeContagem(itensSessaoInventarioCache);
        
        // Adiciona os listeners aos inputs de contagem (MUITO IMPORTANTE)
        adicionarListenersContagem();
        
        // Configura os filtros com base nos itens carregados
        configurarFiltrosInventario();

         // A função retorna uma função de limpeza, que guardamos na variável global
        limparListenerRodape = gerenciarRodapeAcoesFixo();


    } catch (error) {
        console.error(`[mostrarTelaDeContagem] Erro:`, error);
        container.innerHTML = `<p style="color:red; text-align:center;">Erro ao carregar itens da sessão de inventário.</p>`;
        // Oferece uma forma de voltar em caso de erro
        setTimeout(() => { window.location.hash = '#inventario'; }, 3000);
    } finally {
        overlay.classList.add('hidden');
    }
}

function renderizarItensDeContagem(itens) {
    const container = document.getElementById('inventarioItensContainer');
    container.innerHTML = '';

    if (!itens || itens.length === 0) {
        container.innerHTML = htmlUIFeedbackNotFound({
            icon: 'fa-clipboard-list',
            titulo: 'Nenhum item para contar',
            mensagem: 'Não há itens disponíveis nesta sessão de inventário.',
        });
        return;
    }

    const fragment = document.createDocumentFragment();
    itens.forEach(item => {
        const div = document.createElement('div');
        div.className = 'inventario-item-card';
        
        // Adiciona a classe 'modificado' se a quantidade contada for diferente da do sistema
        if (item.quantidade_contada !== null && item.quantidade_contada !== item.quantidade_sistema) {
            div.classList.add('modificado');
        }

        div.innerHTML = `
            <img src="${item.imagem || '/img/placeholder-image.png'}" alt="${item.produto_nome}" class="inventario-item-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
            
            <div class="inventario-item-info">
                <div class="nome-produto">${item.produto_nome}</div>
                <div class="variante-produto">${item.variante_nome}</div>
                <div class="sku-produto">SKU: ${item.produto_ref_id}</div>
            </div>

            <div class="inventario-item-saldos">
                <div class="saldo-bloco">
                    <div class="label">ATUAL</div>
                    <div class="valor sistema">${item.quantidade_sistema}</div>
                </div>
            </div>

            <div class="inventario-item-input-container">
                <input 
                    type="number" 
                    class="es-input input-contagem" 
                    value="${item.quantidade_contada !== null ? item.quantidade_contada : ''}"
                    placeholder="nova qtde"
                    min="0"
                    data-ref-id="${item.produto_ref_id}">
            </div>
        `;
        fragment.appendChild(div);
    });

    container.appendChild(fragment);
}

function adicionarListenersContagem() {
    const container = document.getElementById('inventarioItensContainer');
    const btnRevisar = document.getElementById('btnRevisarInventario'); // <<< Pega a referência do botão aqui
    
    // Usando delegação de eventos para performance
    container.addEventListener('input', debounce(async (event) => {
        if (event.target.classList.contains('input-contagem')) {
            const input = event.target;
            const produtoRefId = input.dataset.refId;
            const quantidadeStr = input.value;

            // Não faz nada se o campo estiver vazio
            if (quantidadeStr.trim() === '') {
                return;
            }
            
            const quantidade = parseInt(quantidadeStr, 10);

            // Validação simples no frontend
            if (isNaN(quantidade) || quantidade < 0) {
                input.style.borderColor = 'red'; // Feedback visual de erro
                return;
            }
            
            input.style.borderColor = ''; // Reseta o feedback visual
            input.disabled = true; // Desabilita o input enquanto salva

            try {
                await fetchEstoqueAPI(`/inventario/sessoes/${sessaoInventarioAtiva.id}/contar`, {
                    method: 'POST',
                    body: JSON.stringify({
                        produto_ref_id: produtoRefId,
                        quantidade_contada: quantidade
                    })
                });

                // *** LÓGICA CORRIGIDA E ADICIONADA AQUI ***
                // Se o botão de revisão ainda estiver desabilitado, habilita-o.
                // Isso acontecerá apenas na primeira vez que uma contagem for salva com sucesso.
                if (btnRevisar.disabled) {
                    btnRevisar.disabled = false;
                    mostrarMensagem('Contagem salva. Você já pode revisar e finalizar o inventário.', 'info', 3000);
                }
                // ********************************************

                // Atualiza o cache local para refletir a contagem
                const itemCache = itensSessaoInventarioCache.find(i => i.produto_ref_id === produtoRefId);
                if (itemCache) {
                    itemCache.quantidade_contada = quantidade;
                    // Atualiza o visual do card (adiciona/remove classe 'modificado')
                    const card = input.closest('.inventario-item-card');
                    if (itemCache.quantidade_contada !== itemCache.quantidade_sistema) {
                        card.classList.add('modificado');
                    } else {
                        card.classList.remove('modificado');
                    }
                }

            } catch (error) {
                console.error('Erro ao salvar contagem:', error);
                mostrarMensagem(`Falha ao salvar a contagem para ${produtoRefId}`, 'erro');
                input.style.borderColor = 'red';
            } finally {
                input.disabled = false; // Reabilita o input
            }
        }
    }, 700)); // Espera 800ms após o usuário parar de digitar para salvar
}

function configurarFiltrosInventario() {
    // Referências aos elementos de filtro
    const filtroProdutoSelect = document.getElementById('invFiltroProduto');
    const filtrosVariacoesContainer = document.getElementById('invFiltrosVariacoesContainer');
    const buscaSkuInput = document.getElementById('invBuscaSku');
    const containerFiltrosVisualizacao = document.querySelector('.inventario-filtros-visualizacao');

    // Limpa filtros anteriores para evitar duplicação
    filtroProdutoSelect.innerHTML = '';
    filtrosVariacoesContainer.innerHTML = '';
    buscaSkuInput.value = '';

    // --- 1. Popular o filtro de Produto Principal ---
    const nomesDeProdutos = [...new Set(itensSessaoInventarioCache.map(item => item.produto_nome))].sort();
    
    let optionsHtml = '<option value="">-- Todos os Produtos --</option>';
    nomesDeProdutos.forEach(nome => {
        optionsHtml += `<option value="${nome}">${nome}</option>`;
    });
    filtroProdutoSelect.innerHTML = optionsHtml;

    // --- 2. Adicionar Event Listeners ---
    filtroProdutoSelect.addEventListener('change', aplicarFiltrosInventario);
    buscaSkuInput.addEventListener('input', debounce(aplicarFiltrosInventario, 350));
    
    // Listener para os filtros de rádio (visualização)
    containerFiltrosVisualizacao.addEventListener('change', (event) => {
        if (event.target.name === 'filtroContagem') {
            aplicarFiltrosInventario();
        }
    });

    // Listener para os filtros de variação (que serão criados dinamicamente)
    filtrosVariacoesContainer.addEventListener('change', (event) => {
        if (event.target.tagName === 'SELECT') {
            aplicarFiltrosInventario();
        }
    });

    // Listener especial para o filtro de produto, que cria os filtros de variação
    filtroProdutoSelect.addEventListener('change', () => {
        const produtoSelecionado = filtroProdutoSelect.value;
        criarFiltrosDeVariacao(produtoSelecionado);
        aplicarFiltrosInventario(); // Aplica todos os filtros novamente
    });
}

function criarFiltrosDeVariacao(produtoNome) {
    const container = document.getElementById('invFiltrosVariacoesContainer');
    container.innerHTML = ''; // Limpa os filtros de variação antigos

    if (!produtoNome) {
        return; // Se o usuário selecionar "Todos os Produtos", não há filtros de variação
    }

    // Encontra a definição de um produto para saber a estrutura das variações
    const produtoDef = todosOsProdutosCadastrados.find(p => p.nome === produtoNome);
    if (!produtoDef || !produtoDef.variacoes || produtoDef.variacoes.length === 0) {
        return; // Produto sem variações definidas
    }

    // Pega todos os itens da sessão que pertencem a este produto
    const itensDoProduto = itensSessaoInventarioCache.filter(i => i.produto_nome === produtoNome);

    produtoDef.variacoes.forEach((variacaoDef, index) => {
        // Coleta todos os valores únicos para esta variação (ex: todas as cores)
        const valoresUnicos = [...new Set(
            itensDoProduto.map(item => {
                const partes = item.variante_nome.split(' | ');
                return partes[index] ? partes[index].trim() : null;
            }).filter(Boolean) // Remove nulos ou vazios
        )].sort();

        if (valoresUnicos.length > 1) { // Só cria o filtro se houver mais de uma opção
            const formGrupo = document.createElement('div');
            formGrupo.className = 'es-form-grupo';
            
            formGrupo.innerHTML = `
                <label for="invFiltroVar-${variacaoDef.chave}">${variacaoDef.chave}</label>
                <select id="invFiltroVar-${variacaoDef.chave}" class="es-select filtro-variacao-inv" data-variacao-index="${index}">
                    <option value="">-- Todos os ${variacaoDef.chave}s --</option>
                    ${valoresUnicos.map(val => `<option value="${val}">${val}</option>`).join('')}
                </select>
            `;
            container.appendChild(formGrupo);
        }
    });
}

function aplicarFiltrosInventario() {
    // Pega os valores atuais de todos os filtros
    const produtoFiltro = document.getElementById('invFiltroProduto').value;
    const skuFiltro = document.getElementById('invBuscaSku').value.toLowerCase();
    const filtroVisualizacao = document.querySelector('input[name="filtroContagem"]:checked').value;

    let itensFiltrados = [...itensSessaoInventarioCache];

    // 1. Filtro por Produto Principal
    if (produtoFiltro) {
        itensFiltrados = itensFiltrados.filter(item => item.produto_nome === produtoFiltro);
    }

    // 2. Filtro por Variações Dinâmicas
    document.querySelectorAll('.filtro-variacao-inv').forEach(select => {
        const valor = select.value;
        const index = parseInt(select.dataset.variacaoIndex, 10);
        if (valor) {
            itensFiltrados = itensFiltrados.filter(item => {
                const partes = item.variante_nome.split(' | ');
                return partes[index] && partes[index].trim() === valor;
            });
        }
    });

    // 3. Filtro por SKU
    if (skuFiltro) {
        itensFiltrados = itensFiltrados.filter(item => item.produto_ref_id.toLowerCase().includes(skuFiltro));
    }

    // 4. Filtro de Visualização
    switch (filtroVisualizacao) {
        case 'nao_contados':
            itensFiltrados = itensFiltrados.filter(item => item.quantidade_contada === null);
            break;
        case 'divergentes':
            itensFiltrados = itensFiltrados.filter(item => item.quantidade_contada !== null && item.quantidade_contada !== item.quantidade_sistema);
            break;
        // O caso 'todos' já é o padrão, não precisa de filtro.
    }

    // Re-renderiza a lista com os itens filtrados
    renderizarItensDeContagem(itensFiltrados);
}

function abrirModalRevisao() {
    const modal = document.getElementById('modalRevisaoInventario');
    const tbody = document.getElementById('tabelaRevisaoInventarioBody');
    tbody.innerHTML = ''; // Limpa a tabela

    // Filtra apenas os itens com divergência
    const itensDivergentes = itensSessaoInventarioCache.filter(
        item => item.quantidade_contada !== null && item.quantidade_contada !== item.quantidade_sistema
    );

    if (itensDivergentes.length === 0) {
        mostrarMensagem('Nenhuma divergência encontrada. Não há nada a ajustar.', 'info');
        return;
    }

    itensDivergentes.forEach(item => {
        const tr = tbody.insertRow();
        const diferenca = item.quantidade_contada - item.quantidade_sistema;
        const classeDiferenca = diferenca > 0 ? 'diferenca-positiva' : 'diferenca-negativa';
        const sinal = diferenca > 0 ? '+' : '';

        tr.innerHTML = `
            <td>
                <strong>${item.produto_nome}</strong><br>
                <small>${item.variante_nome}</small>
            </td>
            <td style="text-align: center;">${item.quantidade_sistema}</td>
            <td style="text-align: center;">${item.quantidade_contada}</td>
            <td style="text-align: center;" class="${classeDiferenca}">${sinal}${diferenca}</td>
        `;
    });

    modal.style.display = 'flex';
}

function fecharModalRevisao() {
    document.getElementById('modalRevisaoInventario').style.display = 'none';
}

async function finalizarInventario() {
    const btn = document.getElementById('btnConfirmarFinalizacaoInventario');
    const confirmado = await mostrarConfirmacao(
        'Tem certeza que deseja finalizar este inventário?<br>Os saldos de estoque dos itens listados serão <b>permanentemente ajustados</b>.',
        'perigo'
    );

    if (!confirmado) return;

    btn.disabled = true;
    btn.innerHTML = `${htmlUICarregando({ variante: 'inline', tamanho: 'sm' })} Finalizando...`;

    try {
        const resultado = await fetchEstoqueAPI(`/inventario/sessoes/${sessaoInventarioAtiva.id}/finalizar`, {
            method: 'POST'
        });

        mostrarMensagem(resultado.message, 'sucesso');
        
        // Limpa o cache de estoque para forçar a recarga na próxima vez que a tela principal for vista
        saldosEstoqueGlobaisCompletos = [];
        
        // Limpa a sessão ativa e volta para a home do inventário
        sessaoInventarioAtiva = null;
        fecharModalRevisao();
        window.location.hash = '#inventario'; // Volta para a home do inventário que irá recarregar

    } catch (error) {
        console.error('Erro ao finalizar inventário:', error);
        mostrarMensagem(`Falha ao finalizar: ${error.data?.details || error.message}`, 'erro');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-check-circle"></i> Confirmar e Ajustar Estoque';
    }
}

function gerenciarRodapeAcoesFixo() {
    const rodape = document.getElementById('inventarioContagem').querySelector('.inventario-rodape-acoes');
    const containerItens = document.getElementById('inventarioItensContainer');
    
    if (!rodape || !containerItens) return;

    const gatilhoPosicao = containerItens.offsetTop;

    const handleScroll = () => {
        if (window.scrollY > gatilhoPosicao) {
            rodape.classList.add('flutuante');
        } else {
            rodape.classList.remove('flutuante');
        }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });

    return () => {
        window.removeEventListener('scroll', handleScroll);
        rodape.classList.remove('flutuante');
    };
}


function setupEventListenersEstoque() {
    console.log('[Estoque setupEventListenersEstoque] Configurando listeners...');

    // Listener para o corpo do documento para tratar cliques em botões dinâmicos de forma segura
    document.getElementById('modalFinalizarSeparacao')?.addEventListener('click', function(event) {
        const removerBtn = event.target.closest('.remover-item-btn');
        if (removerBtn) {
            event.stopPropagation(); // Impede que o clique se propague
            const refId = removerBtn.dataset.refId;
            if (refId) {
                removerItemDoCarrinho(refId);
            }
        }
    });

     // --- Novos Listeners para os Filtros ---
    const toggleFiltrosBtnEl = document.getElementById('toggleFiltrosAvancadosBtn');
    const filtrosContainerEl = document.getElementById('filtrosAvancados'); // O ID do container é 'filtrosAvancados'

    if (toggleFiltrosBtnEl && filtrosContainerEl) {
        toggleFiltrosBtnEl.addEventListener('click', () => {
            filtrosContainerEl.classList.toggle('hidden');
            
            // Lógica para mudar o texto do botão
            const isHidden = filtrosContainerEl.classList.contains('hidden');
            const span = toggleFiltrosBtnEl.querySelector('span');
            if (span) {
                span.textContent = isHidden ? 'Filtros Avançados' : 'Fechar Filtros';
            }
        });
    }

    document.getElementById('filtroFilaStatusSelect')?.addEventListener('change', renderizarFilaDeProducao);
    document.getElementById('limparFiltrosFilaBtn')?.addEventListener('click', () => {
    document.getElementById('filtroFilaStatusSelect').value = '';
    document.getElementById('filtroFilaProdutoSelect').value = '';
    document.querySelectorAll('.filtro-dinamico-fila').forEach(s => s.value = '');
    renderizarFilaDeProducao();
    });

    // --- Listeners de Elementos Estáticos ---
    // (O resto da função permanece o mesmo que a versão anterior que te passei)
    document.getElementById('searchEstoque')?.addEventListener('input', debounce(() => {
        filtroAlertaAtivo = null; currentPageEstoqueTabela = 1;
        carregarTabelaEstoque(document.getElementById('searchEstoque').value, 1);
    }, 350));
    document.getElementById('cardReposicaoUrgente')?.addEventListener('click', mostrarViewFilaProducao);
    document.getElementById('cardEstoqueBaixo')?.addEventListener('click', mostrarViewFilaProducao);
    document.getElementById('btnMostrarTodosEstoque')?.addEventListener('click', () => {
    filtroAlertaAtivo = null; document.getElementById('searchEstoque').value = ''; currentPageEstoqueTabela = 1;
    document.getElementById('filtroAtivoHeader').style.display = 'none';
    document.querySelectorAll('.es-alerta-card').forEach(c => c.classList.remove('filtro-ativo'));
    carregarTabelaEstoque('', 1);
    });

    document.querySelectorAll('.es-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => mudarAbaFila(btn.dataset.tab));
    });


    //LISTENER PARA O BOTÃO DE ATUALIZAR
    const btnAtualizarEstoque = document.getElementById('btnAtualizarEstoque');
    if (btnAtualizarEstoque) {
        btnAtualizarEstoque.addEventListener('click', forcarAtualizacaoEstoque);
    }

    // Listeners para os botões da nova view
    document.getElementById('btnSalvarPrioridades')?.addEventListener('click', salvarPrioridades);

    document.getElementById('btnGerenciarFila')?.addEventListener('click', mostrarViewFilaProducao);
    document.getElementById('btnConfigurarNiveisEstoque')?.addEventListener('click', abrirModalConfigurarNiveis);
    document.getElementById('fecharModalNiveis')?.addEventListener('click', fecharModalNiveis);
    document.getElementById('btnCancelarModalNiveis')?.addEventListener('click', fecharModalNiveis);
    document.getElementById('btnSalvarNiveisEmLote')?.addEventListener('click', salvarNiveisEmLote);
    document.getElementById('buscaProdutoNiveisModal')?.addEventListener('input', debounce(() => {
        const termo = document.getElementById('buscaProdutoNiveisModal').value.toLowerCase();
        const itensFiltrados = todosProdutosParaConfigNiveis.filter(item => item.nome_completo.toLowerCase().includes(termo));
        renderizarTabelaConfigNiveis(itensFiltrados);
    }, 300));
    document.getElementById('voltarParaListaBtn')?.addEventListener('click', () => { window.location.hash = ''; });
    document.getElementById('salvarMovimentoBtn')?.addEventListener('click', salvarMovimentoManualEstoque);
    document.getElementById('btnAbrirHistorico')?.addEventListener('click', abrirModalHistorico);
    document.getElementById('fecharModalHistorico')?.addEventListener('click', fecharModalHistorico);
    document.getElementById('arquivarItemBtn')?.addEventListener('click', arquivarItemEstoque);
    document.getElementById('btnIniciarSeparacao')?.addEventListener('click', mostrarViewSeparacao);
    document.getElementById('searchSeparacaoProdutoBase')?.addEventListener('input', debounce(renderizarProdutosBase, 350));
    document.getElementById('carrinhoSeparacao')?.addEventListener('click', abrirModalFinalizacao);    document.getElementById('fecharModalFinalizar')?.addEventListener('click', fecharModalFinalizacao);
    document.getElementById('btnCancelarFinalizacao')?.addEventListener('click', fecharModalFinalizacao);
    document.getElementById('btnConfirmarSaidaEstoque')?.addEventListener('click', confirmarSaidaEstoque);
    window.addEventListener('hashchange', handleHashChangeEstoque);
    console.log('[Estoque setupEventListenersEstoque] Todos os listeners foram configurados corretamente.');
    
    // --- LÓGICA DO BOTÃO VOLTAR AO TOPO ---
        const btnVoltarAoTopo = document.getElementById('btnVoltarAoTopo');
        if (btnVoltarAoTopo) {
            // Ação de clique: rolar para o topo suavemente
            btnVoltarAoTopo.addEventListener('click', () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });

            // Mostra/esconde o botão baseado na posição da rolagem
            window.addEventListener('scroll', () => {
                if (window.scrollY > 300) { // Mostra o botão se o usuário rolou mais de 300px
                    btnVoltarAoTopo.classList.remove('hidden');
                } else {
                    btnVoltarAoTopo.classList.add('hidden');
                }
            });
        }

    // --- LÓGICA DE PERMISSÃO PARA O BOTÃO "VER ARQUIVADOS" ---
    const btnVerArquivados = document.getElementById('btnVerArquivados');
    if (btnVerArquivados) {
        // Verifica se o usuário tem a permissão
        if (permissoesGlobaisEstoque.includes('editar-itens-arquivados')) {
            // Se tem permissão, o botão funciona normalmente
            btnVerArquivados.addEventListener('click', abrirModalArquivados);
        } else {
            // Se NÃO tem permissão, adiciona a classe de estilo e o listener para o popup
            btnVerArquivados.classList.add('permissao-negada');
            btnVerArquivados.addEventListener('click', () => {
                mostrarMensagem('Você não tem permissão para visualizar e editar itens arquivados.', 'aviso');
            });
        }
    }

    // --- LISTENERS PARA FECHAR O MODAL DE ARQUIVADOS E RESTAURAR ITENS ---
    const fecharModalArquivadosBtn = document.getElementById('fecharModalArquivados');
    if (fecharModalArquivadosBtn) {
        // Listener para o botão 'X' de fechar
        fecharModalArquivadosBtn.addEventListener('click', fecharModalArquivados);
    }

    const modalArquivados = document.getElementById('modalItensArquivados');
    if (modalArquivados) {
        modalArquivados.addEventListener('click', (event) => {
            // Delegação de evento para os botões de restaurar
            const restaurarBtn = event.target.closest('.btn-restaurar-item');
            if (restaurarBtn) {
                handleRestaurarItemClick(event);
                return; // Impede que o clique no botão feche o modal
            }

            // Fecha o modal se o clique for no fundo (overlay)
            if (event.target === modalArquivados) {
                fecharModalArquivados();
            }
        });
    }

    // --- LÓGICA DE PERMISSÃO E AÇÃO PARA O BOTÃO DE INVENTÁRIO ---
    const btnRealizarInventario = document.getElementById('btnRealizarInventario');
    if (btnRealizarInventario) {
        if (permissoesGlobaisEstoque.includes('fazer-inventario')) {
            btnRealizarInventario.addEventListener('click', () => {
                window.location.hash = '#inventario';
            });
        } else {
            btnRealizarInventario.classList.add('permissao-negada');
            btnRealizarInventario.disabled = true; // Desabilita semanticamente
            btnRealizarInventario.addEventListener('click', (e) => {
                e.preventDefault(); // Garante que nenhuma ação padrão ocorra
                mostrarMensagem('Você não tem permissão para realizar inventários.', 'aviso');
            });
        }
    }


    document.getElementById('btnAbrirHistoricoGeralEstoque')?.addEventListener('click', abrirModalHistoricoGeralEstoque);
    document.getElementById('filtroEventoEstoque')?.addEventListener('change', () => carregarHistoricoGeralEstoque(1));
    document.getElementById('filtroPeriodoEstoque')?.addEventListener('change', () => carregarHistoricoGeralEstoque(1));

    // Listener para iniciar um novo inventário
    document.getElementById('btnIniciarNovoInventario')?.addEventListener('click', iniciarNovoInventario);

    document.getElementById('btnContinuarInventario')?.addEventListener('click', () => {
    if (sessaoInventarioAtiva) {
        window.location.hash = `#inventario/contagem/${sessaoInventarioAtiva.id}`;
        mostrarMensagem(`Continuando inventário #${sessaoInventarioAtiva.id}. Tela de contagem a ser implementada.`, 'info');
    } else {
        mostrarMensagem('Nenhuma sessão de inventário ativa encontrada para continuar.', 'erro');
    }
    });

    document.getElementById('btnRevisarInventario')?.addEventListener('click', abrirModalRevisao);
    document.getElementById('fecharModalRevisaoInventario')?.addEventListener('click', fecharModalRevisao);
    document.getElementById('cancelarRevisaoInventario')?.addEventListener('click', fecharModalRevisao);
    document.getElementById('btnConfirmarFinalizacaoInventario')?.addEventListener('click', finalizarInventario);

    document.getElementById('fecharModalDetalhesInventario')?.addEventListener('click', fecharModalDetalhesInventario);

}

// --- INICIALIZAÇÃO DA PÁGINA (Ponto de entrada) ---
document.addEventListener('DOMContentLoaded', async () => {
    try {
        const auth = await verificarAutenticacao('admin/estoque.html', ['acesso-estoque']);
        if (!auth) return; 
        permissoesGlobaisEstoque = auth.permissoes || [];
        usuarioLogadoEstoque = auth.usuario;
        document.body.classList.add('autenticado');
        await inicializarPaginaEstoque();
        removerCarregamentoInicial();
    } catch (error) {
        console.error('[Estoque DOMContentLoaded] Erro:', error);
        mostrarMensagem('Erro crítico ao carregar a página de estoque.', 'erro');
    }
});

const funcoesGlobaisEstoque = {
    iniciarProducao,
    anularPromessa,
    moverItemFila,
    removerItemDoCarrinho
};

// Anexa todas as funções acima ao objeto window
Object.assign(window, funcoesGlobaisEstoque);
