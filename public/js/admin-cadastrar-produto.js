import { verificarAutenticacao } from '/js/utils/auth.js';
import { htmlUICarregando, removerCarregamentoInicial } from './utils/ui-carregando.js';
import { obterProdutos, invalidateCache } from '/js/utils/storage.js';
import { PRODUTOS, PRODUTOSKITS, MAQUINAS, PROCESSOS } from '/js/utils/prod-proc-maq.js';
import { htmlUIFeedbackNotFound } from './utils/ui-feedback.js';
import { temPermissao, mostrarPopupSemPermissao } from '/src/utils/bloqueio';

const PERMISSAO_CONSULTAR_PRODUTOS = 'ver-lista-produtos';
const PERMISSAO_GERENCIAR_PRODUTOS = 'gerenciar-produtos';

function exigirPermissao(permissao, mensagem) {
    if (temPermissao(permissao)) return true;
    mostrarPopupSemPermissao(mensagem, {
        titulo: 'Ação bloqueada',
        rotuloBotao: 'Entendi',
    });
    return false;
}

function exigirConsultaProdutos() {
    return exigirPermissao(
        PERMISSAO_CONSULTAR_PRODUTOS,
        'Você não tem permissão para consultar os produtos deste catálogo.',
    );
}

function exigirGerenciamentoProdutos() {
    return exigirPermissao(
        PERMISSAO_GERENCIAR_PRODUTOS,
        'Você não tem permissão para criar ou editar produtos, kits e etapas de produção.',
    );
}

function atualizarEstadoVisualDasAcoes() {
    document.querySelectorAll('[data-permissao="gerenciar-produtos"]').forEach((controle) => {
        const bloqueado = !temPermissao(PERMISSAO_GERENCIAR_PRODUTOS);
        controle.classList.toggle('cp-permissao-bloqueada', bloqueado);
        controle.setAttribute('aria-disabled', String(bloqueado));
        controle.setAttribute('data-permissao-bloqueada', String(bloqueado));
    });
}

// --- Variáveis Globais ---
let produtos = [];
let editingProduct = null;
let gradeTemp = [];

// --- Elementos do DOM ---
const elements = {
    productListView: document.getElementById('productListView'),
    productFormView: document.getElementById('productFormView'),
    productTableBody: document.getElementById('productTableBody'),
    searchProduct: document.getElementById('searchProduct'),
    productForm: document.getElementById('productForm'),
    editProductNameDisplay: document.getElementById('editProductName'),
    inputProductName: document.getElementById('inputProductName'),
    sku: document.getElementById('sku'),
    gtin: document.getElementById('gtin'),
    unidade: document.getElementById('unidade'),
    estoque: document.getElementById('estoque'),
    imagemProduto: document.getElementById('imagemProduto'),
    previewImagem: document.getElementById('previewImagem'),
    removeImagem: document.getElementById('removeImagem'),
    stepsBody: document.getElementById('stepsBody'),
    etapasTiktikBody: document.getElementById('etapasTiktikBody'),
    tabFilter: document.getElementById('tabFilter'),
    gradeHeader: document.getElementById('gradeHeader'),
    gradeBody: document.getElementById('gradeBody'),
    variationsComponentContainer: document.getElementById('variationsComponentContainer'),
    gradeImagePopup: document.getElementById('gradeImagePopup'),
    gradeImageInput: document.getElementById('gradeImageInput'),
    variacaoPopup: document.getElementById('variacaoPopup'),
    novaVariacaoDescricao: document.getElementById('novaVariacaoDescricao'),
    configurarVariacaoView: document.getElementById('configurarVariacaoView'),
    configurarVariacaoTitle: document.getElementById('configurarVariacaoTitle'),
    btnDropdownFiltroProd: document.getElementById('btnDropdownFiltroProd'),
    filtroProdLabel: document.getElementById('filtroProdLabel'),
    dropdownFiltroProdMenu: document.getElementById('dropdownFiltroProdMenu'),
    inputBuscaProdDropdown: document.getElementById('inputBuscaProdDropdown'),
    listaProdsDropdown: document.getElementById('listaProdsDropdown'),
    cpKitBuscaInput: document.getElementById('cpKitBuscaInput'),
    cpKitBuscaLimpar: document.getElementById('cpKitBuscaLimpar'),
    cpKitCatalogoContainer: document.getElementById('cpKitCatalogoContainer'),
    cpKitResumoPecas: document.getElementById('cpKitResumoPecas'),
    composicaoKitContainer: document.getElementById('composicaoKitContainer'),
};

let currentGradeIndex = null;
let currentKitVariationIndex = null;
let kitComposicaoTemp = [];
let filtroProdutoAtivo = null;

function mostrarPopup(mensagem, tipo = 'sucesso', duracao = 4000) {
    // Encontra ou cria o container para os pop-ups
    let wrapper = document.getElementById('cp-popup-wrapper');
    if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.id = 'cp-popup-wrapper';
        wrapper.className = 'cp-popup-mensagem-wrapper';
        document.body.appendChild(wrapper);
    }

    const popup = document.createElement('div');
    popup.className = `cp-popup-mensagem ${tipo}`;

    const iconMap = {
        sucesso: 'fa-check-circle',
        erro: 'fa-times-circle',
        aviso: 'fa-exclamation-triangle'
    };

    popup.innerHTML = `
        <i class="fas ${iconMap[tipo]} icon"></i>
        <span class="text">${mensagem}</span>
    `;

    wrapper.appendChild(popup);

    // Remove o popup após a animação de saída terminar
    setTimeout(() => {
        popup.style.animation = 'cp-fadeOut 0.4s ease-out forwards';
        setTimeout(() => {
            popup.remove();
            if (wrapper.children.length === 0) {
                wrapper.remove();
            }
        }, 400);
    }, duracao);
}


function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (e) {
        console.error("Erro ao clonar objeto:", obj, e);
        return {};
    }
}

// --- Funções de Inicialização e Eventos ---
async function inicializarPagina() {
    const auth = await verificarAutenticacao('admin/cadastrar-produto.html', ['acesso-cadastrar-produto']);
    if (!auth) return;
    document.body.classList.add('autenticado');
    produtos = await obterProdutos(true);
    configurarEventListeners();
    atualizarEstadoVisualDasAcoes();
    
    // ANTES: window.addEventListener('hashchange', toggleView); toggleView();
    // DEPOIS:
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Executa uma vez para tratar o estado inicial da URL
    removerCarregamentoInicial();
}

// SUBSTITUA TODA A FUNÇÃO EM admin-cadastrar-produto.js
function configurarEventListeners() {
    console.log('[configurarEventListeners] Configurando listeners...');
    
    // --- Listeners para Elementos Estáticos (adicionados uma única vez) ---

    // Lista de Produtos e Filtros
    document.getElementById('btnAdicionarNovoProduto')?.addEventListener('click', () => {
        if (exigirGerenciamentoProdutos()) handleAdicionarNovoProduto();
    });
    elements.searchProduct?.addEventListener('input', () => filterProducts());
    document.querySelectorAll('.cp-type-btn').forEach(btn => btn.addEventListener('click', () => filterProducts(btn.dataset.type)));
    
    // Formulário Principal e Abas
    document.getElementById('btnVoltarDoForm')?.addEventListener('click', () => { window.location.hash = ''; });
    elements.productForm?.addEventListener('submit', handleFormSubmit);
    elements.imagemProduto?.addEventListener('click', (event) => {
        if (!exigirGerenciamentoProdutos()) event.preventDefault();
    });
    elements.imagemProduto?.addEventListener('change', (event) => handleImagemChange(event, 'principal'));
    elements.removeImagem?.addEventListener('click', handleRemoveImagem);
    document.querySelectorAll('input[name="tipo"]').forEach(cb => {
        cb.addEventListener('click', (event) => {
            if (!exigirGerenciamentoProdutos()) event.preventDefault();
        });
        cb.addEventListener('change', toggleTabs);
    });

    // Aba de Produção: a edição das etapas é controlada pelo componente React.
    document.getElementById('btnSalvarProducao')?.addEventListener('click', salvarEtapasProducao);

    // Aba de Variações
    document.getElementById('btnAddVariacao')?.addEventListener('click', () => {
        if (exigirGerenciamentoProdutos()) addVariacaoRow();
    });
    document.getElementById('btnSalvarGrade')?.addEventListener('click', salvarGrade); 

    // Modal de Seleção de Imagem (para a grade)
    document.getElementById('btnTriggerUpload')?.addEventListener('click', () => {
        if (!exigirGerenciamentoProdutos()) return;
        document.getElementById('gradeImageInput')?.click();
    });
    document.getElementById('gradeImageInput')?.addEventListener('change', (event) => handleImagemChange(event, 'grade'));
    document.getElementById('btnFecharModalSelecaoImagem')?.addEventListener('click', fecharModalSelecaoImagem);

    // Modal de Configuração de Kit (Visual, sem selects)
    document.getElementById('saveKitConfigBtn')?.addEventListener('click', salvarComposicaoKit);
    elements.cpKitBuscaInput?.addEventListener('input', (e) => {
        const val = e.target.value;
        if (elements.cpKitBuscaLimpar) {
            elements.cpKitBuscaLimpar.style.display = val ? 'block' : 'none';
        }
        renderizarCatalogoComponentes(val);
    });
    elements.cpKitBuscaLimpar?.addEventListener('click', () => {
        if (elements.cpKitBuscaInput) {
            elements.cpKitBuscaInput.value = '';
            elements.cpKitBuscaInput.focus();
        }
        if (elements.cpKitBuscaLimpar) {
            elements.cpKitBuscaLimpar.style.display = 'none';
        }
        renderizarCatalogoComponentes('');
    });

    // Seletor Visual de Produto (Dropdown)
    elements.btnDropdownFiltroProd?.addEventListener('click', (e) => {
        e.stopPropagation();
        alternarDropdownFiltroProd();
    });
    elements.dropdownFiltroProdMenu?.addEventListener('click', (e) => {
        e.stopPropagation();
    });
    elements.inputBuscaProdDropdown?.addEventListener('input', (e) => {
        renderizarDropdownProdutos(e.target.value);
    });
    document.addEventListener('click', (e) => {
        if (!elements.dropdownFiltroProdMenu?.contains(e.target) && e.target !== elements.btnDropdownFiltroProd) {
            fecharDropdownFiltroProd();
        }
    });
    
    // --- Delegação de Eventos para a Grade (Itens Dinâmicos) ---
    // Adicionamos um único listener ao corpo da tabela da grade.
    elements.gradeBody.addEventListener('click', function(event) {
        // Verificamos se o elemento clicado (ou seu pai) é um placeholder de imagem.
        const placeholder = event.target.closest('.cp-grade-img-placeholder');
        if (placeholder) {
            const index = placeholder.dataset.index;
            if (index !== undefined) {
                // Se for, abrimos o modal de seleção.
                abrirModalSelecaoImagem(index);
            }
        }
    });

    // --- Delegação de Eventos para as Abas ---
    elements.tabFilter.addEventListener('click', (event) => {
        const btn = event.target.closest('.cp-tab-btn');
        if (btn && btn.dataset.tab) {
            switchTab(btn.dataset.tab);
        }
    });
}

// --- Navegação e Views ---
function handleHashChange() {
    const hash = window.location.hash;
    const isEditing = hash.startsWith('#editando'); // Aceita #editando e #editando/alguma-coisa

    // Controla a visibilidade das views principais
    elements.productListView.style.display = isEditing ? 'none' : 'block';
    elements.productFormView.style.display = isEditing ? 'block' : 'none';

    if (isEditing) {
        // Se estamos na view de edição, mas o produto ainda não foi carregado na memória...
        // Isso acontece principalmente quando o usuário atualiza a página (F5).
        if (!editingProduct) {
            const ultimoProdutoNome = localStorage.getItem('ultimoProdutoEditado');
            if (ultimoProdutoNome) {
                // Encontramos o nome do último produto no localStorage.
                // A função 'iniciarEdicaoProduto' vai cuidar de buscar os dados e carregar o form.
                console.log("handleHashChange: F5 detectado. Iniciando edição para:", ultimoProdutoNome);
                iniciarEdicaoProduto(ultimoProdutoNome);
            } else {
                // Se não há último produto, significa que é um produto novo.
                console.log("handleHashChange: Nenhuma edição em andamento, tratando como novo produto.");
                handleAdicionarNovoProduto();
            }
        }
    } else {
        // Se a hash mudou para qualquer coisa que não seja de edição (ex: #),
        // limpamos o estado de edição e voltamos para a lista.
        editingProduct = null;
        localStorage.removeItem('ultimoProdutoEditado');
        filterProducts(); // Recarrega e filtra a lista de produtos
    }
}

async function iniciarEdicaoProduto(nome) {
    if (!exigirConsultaProdutos()) return;
    const overlay = document.getElementById('formLoadingOverlay');
    try {
        // Passo 1: Mostra o formulário (se não estiver visível) e ATIVA o estado de carregamento.
        if (elements.productFormView.style.display === 'none') {
            elements.productListView.style.display = 'none';
            elements.productFormView.style.display = 'block';
        }
        overlay?.classList.remove('hidden');
        document.body.style.cursor = 'wait';
        
        // Passo 2 (MUITO IMPORTANTE): Limpa o formulário ANTES de buscar os novos dados.
        // Isso evita que dados do produto anterior "vazem" para o novo.
        limparFormularioDeEdicao();

        // Passo 3: Busca os dados mais recentes do produto no backend.
        console.log(`[iniciarEdicaoProduto] Buscando dados atualizados para: ${nome}`);
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/produtos/por-nome?nome=${encodeURIComponent(nome)}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Produto não encontrado.");
        }
        const produtoAtualizado = await response.json();

        // Passo 4: Define as variáveis de estado globais APÓS o sucesso da busca.
        editingProduct = deepClone(produtoAtualizado);
        gradeTemp = deepClone(editingProduct.grade || []);
        localStorage.setItem('ultimoProdutoEditado', nome); // Salva para o caso de F5
        
        // Passo 5: AGORA, com os dados prontos, carrega o formulário.
        loadEditForm(editingProduct);

        // Passo 6: Atualiza a URL no final do processo, se necessário.
        if (window.location.hash !== '#editando') {
            window.history.pushState({ produto: nome }, 'Editando ' + nome, '#editando');
        }
        
    } catch (error) {
        console.error(`[iniciarEdicaoProduto] Erro:`, error);
        mostrarPopup(`Erro ao carregar produto: ${error.message}`, 'erro');
        window.location.hash = ''; // Em caso de erro, volta para a lista
    } finally {
        // Passo 7: Esconde o overlay de carregamento e restaura o cursor.
        overlay?.classList.add('hidden');
        document.body.style.cursor = 'default';
    }
}

function limparFormularioDeEdicao() {
    console.log("Limpando formulário de edição...");
    elements.editProductNameDisplay.innerHTML = '<span class="cp-edit-badge"><i class="fas fa-spinner fa-spin"></i></span> Carregando...';
    elements.inputProductName.value = '';
    elements.sku.value = '';
    elements.gtin.value = '';
    elements.unidade.value = 'pç';
    elements.estoque.value = '0';
    
    // Desmarca todos os checkboxes de tipo
    document.querySelectorAll('input[name="tipo"]').forEach(cb => { cb.checked = false; });
    
    // Limpa a imagem principal
    limparImagemPrincipal();

    // Limpa o conteúdo das tabelas e containers dinâmicos
    const containersParaLimpar = [
        elements.stepsBody,
        elements.etapasTiktikBody,
        elements.variationsComponentContainer,
        elements.gradeBody,
        elements.gradeHeader,
    ];

    containersParaLimpar.forEach(container => {
        if (container) {
            container.innerHTML = '';
        }
    });

    // Garante que a aba de variações (que é dinâmica) seja removida
    const variacoesTabBtn = document.querySelector('.cp-tab-btn[data-tab="variacoes"]');
    if (variacoesTabBtn) {
        variacoesTabBtn.remove();
    }
    // Volta para a primeira aba
    switchTab('dados-gerais');
}



// Esta é a nova função de controle principal
function handleNavigation(hash) {
    const isEditing = (hash === '#editando');

    elements.productListView.style.display = isEditing ? 'none' : 'block';
    elements.productFormView.style.display = isEditing ? 'block' : 'none';

    if (isEditing) {
        if (!editingProduct) {
            const ultimoProdutoNome = localStorage.getItem('ultimoProdutoEditado');
            if (ultimoProdutoNome) {
                // Chama a função de edição para carregar tudo
                editProduct(ultimoProdutoNome);
            } else {
                // Se não há último produto, inicia um novo
                handleAdicionarNovoProduto();
            }
        }
    } else {
        // Se não estamos editando, limpa tudo e recarrega a lista
        editingProduct = null;
        localStorage.removeItem('ultimoProdutoEditado');
        filterProducts();
    }
}

// --- Lista de Produtos ---
function loadProductTable(filteredProdutos) {
    elements.productTableBody.innerHTML = '';
    if (!filteredProdutos || filteredProdutos.length === 0) {
        elements.productTableBody.innerHTML = `<tr><td colspan="6">${htmlUIFeedbackNotFound({
            icon: 'fa-box-open',
            titulo: 'Nenhum produto encontrado',
            mensagem: 'Não há produtos correspondentes à busca.',
        })}</td></tr>`;
        return;
    }
    filteredProdutos.forEach(produto => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.innerHTML = `
            <td data-label=""><img src="${produto.imagem || '/img/placeholder-image.png'}" class="cp-product-thumbnail" onerror="this.onerror=null;this.src='/img/placeholder-image.png';"></td>
            <td data-label="Produto">${produto.nome}</td>
            <td data-label="SKU">${produto.sku || '-'}</td>
            <td data-label="Unidade">${produto.unidade || '-'}</td>
            <td data-label="Estoque">${produto.estoque || 0}</td>
            <td data-label="Tipo">${(produto.tipos || []).join(', ') || '-'}</td>
        `;
        // CORREÇÃO: O clique AGORA SÓ CHAMA iniciarEdicaoProduto.
        tr.addEventListener('click', () => iniciarEdicaoProduto(produto.nome));
        elements.productTableBody.appendChild(tr);
    });
}

function filterProducts(type = 'todos') {
    document.querySelectorAll('.cp-type-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.type === type));
    const searchTerm = elements.searchProduct.value.toLowerCase();
    const filtered = produtos.filter(p =>
        (type === 'todos' || (p.tipos || []).includes(type)) &&
        p.nome.toLowerCase().includes(searchTerm)
    );
    loadProductTable(filtered);
}

async function salvarGrade() {
    if (!editingProduct) return;
    if (!exigirGerenciamentoProdutos()) return;
    try {
        await salvarProdutoNoBackend();
        mostrarPopup('Grade e Variações salvas com sucesso!', 'sucesso');
    } catch (error) { 
        // O erro já é tratado e exibido em salvarProdutoNoBackend, 
        // então não precisamos fazer nada aqui.
    }
}

async function salvarEtapasProducao() {
    if (!editingProduct) return;
    if (!exigirGerenciamentoProdutos()) return;
    console.log("Salvando etapas de produção...");
    try {
        // A função salvarProdutoNoBackend já coleta os dados das etapas do DOM,
        // então só precisamos chamá-la.
        await salvarProdutoNoBackend();
        mostrarPopup('Etapas de produção salvas com sucesso!', 'sucesso');
    } catch (error) {
        // O erro também já é tratado na função principal.
    }
}

// --- Edição de Produto ---
function handleAdicionarNovoProduto() {
    if (!exigirGerenciamentoProdutos()) return;
    // Define o estado para um produto novo em branco
    editingProduct = {
        id: undefined, // Sem ID, indica que é novo
        nome: '', sku: '', gtin: '', unidade: 'pç', estoque: 0, imagem: '',
        tipos: ['simples'], // Começa como simples por padrão
        variacoes: [{ chave: 'Cor', valores: '' }], 
        grade: [], 
        is_kit: false,
        etapas: [], 
        etapasTiktik: []
    };
    gradeTemp = [];
    localStorage.removeItem('ultimoProdutoEditado');
    
    // Atualiza a URL para indicar que estamos no modo de edição/criação
    window.location.hash = 'editando';

    // A função handleHashChange vai detectar a mudança na hash e, como editingProduct está
    // definido, ela não fará nada. Agora, podemos limpar e carregar o formulário com segurança.
    
    // Mostra o formulário e esconde a lista
    elements.productListView.style.display = 'none';
    elements.productFormView.style.display = 'block';
    
    // Limpa qualquer resquício de uma edição anterior
    limparFormularioDeEdicao();
    
    // Carrega o formulário com os dados do nosso objeto de produto novo
    loadEditForm(editingProduct);
}

async function editProduct(nome) {
    if (!exigirConsultaProdutos()) return;
    try {
        document.body.style.cursor = 'wait';
        
        // A view já foi trocada pelo clique do usuário ou pelo hashchange,
        elements.editProductNameDisplay.innerHTML = '<span class="cp-edit-badge"><i class="fas fa-spinner fa-spin"></i></span> Carregando produto...';
        // Limpa o conteúdo antigo para evitar confusão visual
        elements.productForm.style.visibility = 'hidden'; 

        console.log(`Buscando dados atualizados para: ${nome}`);
        const token = localStorage.getItem('token');
        const response = await fetch(`/api/produtos/por-nome?nome=${encodeURIComponent(nome)}`, {
             headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Não foi possível carregar os dados atualizados do produto.");
        }
        
        const produtoAtualizado = await response.json();

        editingProduct = deepClone(produtoAtualizado);
        gradeTemp = deepClone(editingProduct.grade || []);
        
        const indexNaLista = produtos.findIndex(p => p.id === editingProduct.id);
        if (indexNaLista > -1) produtos[indexNaLista] = deepClone(editingProduct);

        // AGORA, com os dados prontos, carrega o formulário
        loadEditForm(editingProduct);
        elements.productForm.style.visibility = 'visible'; // Mostra o formulário preenchido

        localStorage.setItem('ultimoProdutoEditado', nome);

    } catch (error) {
        console.error(`[editProduct] Erro ao carregar produto:`, error);
        mostrarPopup(`Erro ao carregar o produto: ${error.message}`, 'erro');
        window.location.hash = ''; 
    } finally {
        document.body.style.cursor = 'default';
    }
}

function loadEditForm(produto) {
    console.log("Carregando formulário com dados do produto:", produto.nome || "Novo Produto");
    
    // Referência ao wrapper da imagem
    const imagemWrapperEl = document.querySelector('.cp-imagem-wrapper');

    // --- Limpeza Prévia (Opcional aqui, mas bom se loadEditForm for chamado múltiplas vezes sem limpar antes) ---
    // Se você já chama limparFormularioDeEdicao() antes de loadEditForm, esta parte pode ser mais simples.
    // Por segurança, vamos garantir o estado inicial correto para a imagem.
    if (elements.previewImagem) elements.previewImagem.src = '';
    if (imagemWrapperEl) imagemWrapperEl.classList.remove('has-image');
    // (outras limpezas de formulário se não feitas antes)

    elements.editProductNameDisplay.innerHTML = produto.id 
        ? `<span class="cp-edit-badge"><i class="fas fa-pen-to-square"></i> Edição</span> <span>${produto.nome}</span>` 
        : `<span class="cp-edit-badge cp-badge-new"><i class="fas fa-plus"></i> Novo</span> <span>Cadastrar Produto</span>`;
    elements.inputProductName.value = produto.nome || '';
    elements.sku.value = produto.sku || '';
    elements.gtin.value = produto.gtin || '';
    elements.unidade.value = produto.unidade || 'pç'; // Valor padrão se produto.unidade for nulo/undefined
    elements.estoque.value = produto.estoque !== undefined ? produto.estoque : 0; // Valor padrão se produto.estoque for nulo/undefined
    
    // Tipos de produto (checkboxes)
    document.querySelectorAll('input[name="tipo"]').forEach(cb => { 
        cb.checked = (produto.tipos || []).includes(cb.value); 
    });
    
    // --- Lógica da Imagem Principal ---
    if (produto.imagem) {
        if (elements.previewImagem) elements.previewImagem.src = produto.imagem;
        if (imagemWrapperEl) imagemWrapperEl.classList.add('has-image');
    } else {
        // Garante que se não houver imagem, o estado 'sem imagem' seja aplicado
        if (elements.previewImagem) elements.previewImagem.src = ''; // Limpa src para não mostrar imagem quebrada
        if (imagemWrapperEl) imagemWrapperEl.classList.remove('has-image');
    }
    // Input de arquivo não precisa ser resetado aqui, pois é para novo upload.
    // elements.imagemProduto.value = ''; 
    
    // A tabela única de etapas é React. O fallback pendente cobre o intervalo
    // entre o carregamento do produto e a montagem do componente.
    if (typeof window.sincronizarEtapasProduto === 'function') {
        window.sincronizarEtapasProduto(produto);
    } else {
        window.__produtoEtapasPendente = produto;
    }

    // Aba de Variações e Grade
    // A função loadVariacoesComponent e loadGrade já limpam seus respectivos containers.
    loadVariacoesComponent(produto); // Carrega as definições de variação (Cor, Tamanho, etc.)
    loadGrade(); // Carrega a grade de SKUs baseada em gradeTemp (que deve ser populada a partir de produto.grade)

    // --- Controle de Abas ---
    // toggleTabs garante que a aba "Variações e Grade" apareça/desapareça conforme o tipo do produto.
    toggleTabs(); 
    
    // Define qual aba deve estar ativa inicialmente.
    // Se for um produto com variações ou kit, geralmente queremos ir para essa aba.
    // Caso contrário, a aba de dados gerais.
    const temTipoEspecial = (produto.tipos || []).some(t => t === 'variacoes' || t === 'kits');
    const abaParaAtivar = temTipoEspecial ? 'variacoes' : 'dados-gerais';
    
    // Verifica se a aba de destino existe antes de tentar ativá-la
    if (document.querySelector(`.cp-tab-btn[data-tab="${abaParaAtivar}"]`)) {
        switchTab(abaParaAtivar);
    } else {
        // Fallback para a primeira aba se a aba de destino não existir (ex: 'variacoes' foi removida)
        switchTab('dados-gerais');
    }

    console.log("Formulário carregado para:", produto.nome || "Novo Produto");
}

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!exigirGerenciamentoProdutos()) return;
    try {
        await salvarProdutoNoBackend();
        alert('Produto salvo com sucesso!');
        window.location.hash = '';
    } catch (error) { /* erro já tratado em salvarProdutoNoBackend */ }
}

// --- Variações e Grade ---
function loadVariacoesComponent(produto) {
    elements.variationsComponentContainer.innerHTML = '';
    const variacoes = produto.variacoes && produto.variacoes.length > 0 ? produto.variacoes : [{ chave: 'Cor', valores: '' }];
    variacoes.forEach((variacao, index) => addVariacaoRow(variacao.chave, variacao.valores, index));
}

window.addVariacaoRow = function (chave = '', valores = '', index = null) {
    const idx = index !== null ? index : elements.variationsComponentContainer.children.length;
    const div = document.createElement('div');
    div.className = 'cp-variation-row';
    div.dataset.index = idx;
    div.innerHTML = `
        <div class="cp-form-group cp-variation-key-group">
            <label for="chaveVariacao${idx}">Variação</label>
            <input type="text" id="chaveVariacao${idx}" class="cp-input" value="${chave}" placeholder="Ex: Cor">
        </div>
        <div class="cp-form-group cp-variation-values-group">
            <label>Valores</label>
            <div class="cp-tags-input-wrapper" id="tagsWrapper${idx}">
                <input type="text" class="cp-tag-input-field" placeholder="Digite e tecle Enter...">
            </div>
        </div>
        <button type="button" class="cp-remove-btn" data-permissao="gerenciar-produtos" onclick="removeVariacaoRow(this)">×</button>
    `;
    elements.variationsComponentContainer.appendChild(div);
    const tagsWrapper = div.querySelector(`#tagsWrapper${idx}`);
    const inputField = div.querySelector('.cp-tag-input-field');
    const chaveInput = div.querySelector(`#chaveVariacao${idx}`);
    if (valores) {
        valores.split(',').map(v => v.trim()).filter(Boolean).forEach(valor => {
            tagsWrapper.insertBefore(createTag(valor), inputField);
        });
    }
    tagsWrapper.addEventListener('click', () => inputField.focus());
    inputField.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            if (!exigirGerenciamentoProdutos()) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            const valor = inputField.value.trim();
            if (valor && !Array.from(tagsWrapper.querySelectorAll('.cp-tag')).some(t => t.firstChild.textContent.trim() === valor)) {
                tagsWrapper.insertBefore(createTag(valor), inputField);
                inputField.value = '';
                gerarCombinacoesEAtualizarGrade();
            }
        }
    });
    chaveInput.addEventListener('blur', gerarCombinacoesEAtualizarGrade);
    atualizarEstadoVisualDasAcoes();
}

function createTag(text) {
    const tag = document.createElement('span');
    tag.className = 'cp-tag';
    tag.textContent = text;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-tag-btn';
    removeBtn.innerHTML = '×';
    removeBtn.type = "button";
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        if (!exigirGerenciamentoProdutos()) return;
        tag.remove();
        gerarCombinacoesEAtualizarGrade();
    };
    tag.appendChild(removeBtn);
    return tag;
}

window.removeVariacaoRow = function (btn) {
    if (!exigirGerenciamentoProdutos()) return;
    btn.closest('.cp-variation-row').remove();
    gerarCombinacoesEAtualizarGrade();
}

function gerarCombinacoesEAtualizarGrade() {
    const variacoesRows = Array.from(elements.variationsComponentContainer.querySelectorAll('.cp-variation-row'));
    const variacoes = variacoesRows.map(row => ({
        chave: row.querySelector('input[id^="chaveVariacao"]').value.trim(),
        valores: Array.from(row.querySelectorAll('.cp-tag')).map(tag => tag.firstChild.textContent.trim())
    })).filter(v => v.chave && v.valores.length > 0);
    if (variacoes.length === 0) {
        gradeTemp = [];
        loadGrade();
        return;
    }
    const combinations = variacoes.reduce((acc, curr) => (
        acc.length === 0 ? curr.valores.map(val => [val]) : acc.flatMap(combo => curr.valores.map(val => [...combo, val]))
    ), []);
    const novasCombinacoesStr = combinations.map(combo => combo.join(' | '));
    const novasCombinacoesSet = new Set(novasCombinacoesStr);
    gradeTemp = gradeTemp.filter(item => novasCombinacoesSet.has(item.variacao));
    novasCombinacoesStr.forEach(novaVariacao => {
        if (!gradeTemp.some(item => item.variacao === novaVariacao)) {
            gradeTemp.push({ variacao: novaVariacao, sku: '', gtin: '', qtd_pacote: 1, imagem: '', composicao: (editingProduct?.is_kit) ? [] : ['-'] });
        }
    });
    loadGrade();
}

// --- Helper: Resolução de imagem e dados de componente de kit ---
function getComponenteInfo(comp) {
    const nome = comp.produto_nome || comp.produto || 'Componente';
    const variacao = (comp.variacao && comp.variacao !== '-') ? comp.variacao : 'Padrão';
    const prodRef = produtos.find(p => p.id === comp.produto_id || p.nome === nome);
    let imagem = '';
    if (prodRef) {
        if (Array.isArray(prodRef.grade)) {
            const varItem = prodRef.grade.find(g => (g.variacao || '').trim().toLowerCase() === variacao.trim().toLowerCase());
            if (varItem && varItem.imagem) imagem = varItem.imagem;
        }
        if (!imagem && prodRef.imagem) imagem = prodRef.imagem;
    }
    if (!imagem) imagem = '/img/placeholder-image.png';
    return { nome, variacao, imagem, prodRef };
}

function loadGrade() {
    elements.gradeBody.innerHTML = '';
    const isKit = (editingProduct?.tipos || []).includes('kits');
    const headers = Array.from(elements.variationsComponentContainer.querySelectorAll('input[id^="chaveVariacao"]')).map(input => input.value.trim() || 'Variação');
    
    let headerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}`;
    if (isKit) {
        headerHTML += '<th>Composto Por</th>';
    }
    headerHTML += '<th>Código (SKU)</th><th>GTIN/EAN</th><th>Pacote</th><th>Imagem</th><th>Ações</th></tr>';
    elements.gradeHeader.innerHTML = headerHTML;
    const colunasFixas = (isKit ? 1 : 0) + 5;

    if (gradeTemp.length === 0 && headers.length > 0) { // Só mostra mensagem se houver variações definidas
        elements.gradeBody.innerHTML = `<tr><td colspan="${headers.length + colunasFixas}">${htmlUIFeedbackNotFound({
            icon: 'fa-table-list',
            titulo: 'Nenhuma combinação gerada',
            mensagem: 'Defina os valores das variações para montar a grade.',
        })}</td></tr>`;
        return;
    }
    if (gradeTemp.length === 0 && headers.length === 0 && isKit) {
         elements.gradeBody.innerHTML = `<tr><td colspan="${colunasFixas}" style="text-align:center;">Defina as variações do kit acima para gerar a grade.</td></tr>`;
        return;
    }
     if (gradeTemp.length === 0 && !isKit) { // Para produto simples sem variações
        // Não mostra mensagem de "nenhuma combinação" se não for kit e não tiver variações.
        // A grade pode estar vazia legitimamente.
    }


    gradeTemp.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.dataset.index = idx;
        const valores = item.variacao.split(' | ');
        
        // 1. Bloco de Imagem à esquerda (ampla)
        let imagemHtml = `
            <td data-label="Imagem" class="cp-grade-col-imagem">
                <div class="cp-grade-img-placeholder" data-permissao="gerenciar-produtos" onclick="abrirModalSelecaoImagem('${idx}')" title="Clique para escolher a imagem desta combinação">
                    ${item.imagem ? `<img src="${item.imagem}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="${item.variacao}">` : '<div class="cp-grade-img-vazia"><i class="fas fa-camera" aria-hidden="true"></i><span>Foto</span></div>'}
                </div>
            </td>
        `;

        if (isKit) {
            // ==========================================================
            // KITS COM COMPOSIÇÃO: Estrutura em 2 Níveis (Print 1)
            // ==========================================================
            tr.classList.add('cp-grade-card-kit');
            const composicao = item.composicao || [];
            const totalPecas = composicao.reduce((acc, c) => acc + (Number(c.quantidade) || 0), 0);
            const totalItens = composicao.length;

            let tagsHtml = '';
            if (composicao.length > 0) {
                tagsHtml = '<div class="composicao-tags">';
                composicao.forEach(comp => {
                    const info = getComponenteInfo(comp);
                    const qtd = comp.quantidade || 1;
                    tagsHtml += `
                        <span class="composicao-tag" title="${info.nome} - ${info.variacao} (${qtd} un)">
                            <img src="${info.imagem}" class="composicao-tag-thumb" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="">
                            <span class="composicao-tag-nome">${info.nome} <strong class="composicao-tag-var">· ${info.variacao}</strong></span>
                            <span class="composicao-tag-qtd">${qtd} un</span>
                        </span>
                    `;
                });
                tagsHtml += '</div>';
            } else {
                tagsHtml = `
                    <div class="cp-kit-comp-vazia">
                        <i class="fas fa-boxes-stacked"></i>
                        <span>Nenhum componente vinculado a esta variação de kit. Clique em "Configurar Composição".</span>
                    </div>
                `;
            }

            const textoBotao = (composicao.length > 0 && composicao.some(c => c.produto_id || c.produto || c.produto_nome))
                ? 'Editar Composição'
                : 'Configurar Composição';

            tr.innerHTML = `
                ${imagemHtml}
                <td class="cp-grade-kit-conteudo" colspan="${headers.length + colunasFixas - 1}">
                    <div class="cp-grade-kit-topo">
                        <div class="cp-grade-variacao-titulo">
                            ${valores.map((v, i) => `<span class="cp-grade-val-tag" data-label="${headers[i] || ''}">${v}</span>`).join(' <span class="cp-grade-val-sep">·</span> ')}
                        </div>
                        <div class="cp-grade-kit-inputs-row">
                            <div class="cp-grade-campo-item cp-campo-sku">
                                <label for="gradeSku_${idx}">SKU</label>
                                <input type="text" id="gradeSku_${idx}" class="cp-input cp-grade-sku" data-permissao="gerenciar-produtos" value="${item.sku || ''}" onblur="updateGradeSku(${idx}, this.value)" placeholder="SKU">
                            </div>
                            <div class="cp-grade-campo-item cp-campo-gtin">
                                <label for="gradeGtin_${idx}">GTIN / EAN</label>
                                <input type="text" id="gradeGtin_${idx}" class="cp-input cp-grade-gtin" inputmode="numeric" autocomplete="off" spellcheck="false" data-permissao="gerenciar-produtos" value="${item.gtin || ''}" onblur="updateGradeGtin(${idx}, this.value)" placeholder="GTIN/EAN">
                            </div>
                            <div class="cp-grade-campo-item cp-campo-pacote">
                                <label for="gradePacote_${idx}">Pacote</label>
                                <input type="number" id="gradePacote_${idx}" min="1" max="999" class="cp-input cp-grade-pacote" data-permissao="gerenciar-produtos" value="${item.qtd_pacote || 1}" onblur="updateGradePacote(${idx}, this.value)">
                            </div>
                            <div class="cp-grade-campo-item cp-grade-col-acoes" style="margin-left: 2px;">
                                <label>&nbsp;</label>
                                <button type="button" class="cp-remove-btn" data-permissao="gerenciar-produtos" onclick="excluirGrade('${idx}')" title="Excluir combinação">
                                    <i class="fas fa-trash-alt" aria-hidden="true"></i>
                                </button>
                            </div>
                        </div>
                    </div>

                    <div class="cp-grade-kit-composicao-painel">
                        <div class="cp-grade-kit-composicao-bar">
                            <div class="cp-grade-kit-comp-meta">
                                <i class="fas fa-boxes-stacked cp-grade-kit-comp-ico"></i>
                                <span>Composição da Combinação:</span>
                                <span class="cp-grade-kit-comp-contagem"><strong>${totalPecas}</strong> peças no total (${totalItens} ${totalItens === 1 ? 'item' : 'itens'})</span>
                            </div>
                            <button type="button" class="cp-btn-editar-composicao" data-permissao="gerenciar-produtos" onclick="abrirConfigurarVariacao('${idx}')">
                                <i class="fas fa-sliders" aria-hidden="true"></i>
                                <span>${textoBotao}</span>
                            </button>
                        </div>
                        ${tagsHtml}
                    </div>
                </td>
            `;
        } else {
            // ==========================================================
            // PRODUTOS UNITÁRIOS: Mantido 100% como está!
            // ==========================================================
            let infoHtml = `
                <td data-label="Variação" class="cp-grade-col-info">
                    <div class="cp-grade-variacao-titulo">${valores.map((v, i) => `<span class="cp-grade-val-tag" data-label="${headers[i] || ''}">${v}</span>`).join(' <span class="cp-grade-val-sep">·</span> ')}</div>
                </td>
            `;

            let camposHtml = `
                <td data-label="Dados" class="cp-grade-col-campos">
                    <div class="cp-grade-campo-item cp-campo-sku">
                        <label for="gradeSku_${idx}">SKU</label>
                        <input type="text" id="gradeSku_${idx}" class="cp-input cp-grade-sku" data-permissao="gerenciar-produtos" value="${item.sku || ''}" onblur="updateGradeSku(${idx}, this.value)" placeholder="SKU">
                    </div>
                    <div class="cp-grade-campo-item cp-campo-gtin">
                        <label for="gradeGtin_${idx}">GTIN / EAN</label>
                        <input type="text" id="gradeGtin_${idx}" class="cp-input cp-grade-gtin" inputmode="numeric" autocomplete="off" spellcheck="false" data-permissao="gerenciar-produtos" value="${item.gtin || ''}" onblur="updateGradeGtin(${idx}, this.value)" placeholder="GTIN/EAN">
                    </div>
                    <div class="cp-grade-campo-item cp-campo-pacote">
                        <label for="gradePacote_${idx}">Pacote</label>
                        <input type="number" id="gradePacote_${idx}" min="1" max="999" class="cp-input cp-grade-pacote" data-permissao="gerenciar-produtos" value="${item.qtd_pacote || 1}" onblur="updateGradePacote(${idx}, this.value)">
                    </div>
                </td>
            `;

            let acoesHtml = `
                <td data-label="Ações" class="cp-grade-col-acoes">
                    <button type="button" class="cp-remove-btn" data-permissao="gerenciar-produtos" onclick="excluirGrade('${idx}')" title="Excluir combinação">
                        <i class="fas fa-trash-alt" aria-hidden="true"></i>
                    </button>
                </td>
            `;

            tr.innerHTML = imagemHtml + infoHtml + camposHtml + acoesHtml;
        }

        elements.gradeBody.appendChild(tr);
    });
    atualizarEstadoVisualDasAcoes();
}

window.updateGradeSku = (index, sku) => {
    if (!exigirGerenciamentoProdutos()) return;
    if (gradeTemp[index]) gradeTemp[index].sku = sku.trim();
};
window.updateGradeGtin = (index, gtin) => {
    if (!exigirGerenciamentoProdutos()) return;
    if (gradeTemp[index]) gradeTemp[index].gtin = String(gtin || '').trim();
};
window.updateGradePacote = (index, pacote) => {
    if (!exigirGerenciamentoProdutos()) return;
    const quantidade = Number.parseInt(pacote, 10);
    if (gradeTemp[index]) {
        gradeTemp[index].qtd_pacote = Number.isInteger(quantidade) && quantidade > 0 ? quantidade : 1;
    }
};
window.excluirGrade = (index) => {
    if (!exigirGerenciamentoProdutos()) return;
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= gradeTemp.length) return;
    if (confirm(`Tem certeza que deseja excluir a variação "${gradeTemp[idx].variacao}"?`)) {
        gradeTemp.splice(idx, 1);
        loadGrade();
    }
};

window.salvarGrade = async () => {
    if (!editingProduct) return;
    if (!exigirGerenciamentoProdutos()) return;
    try {
        await salvarProdutoNoBackend();
        alert('Grade e Variações salvas com sucesso!');
    } catch (error) { /* erro já tratado */ }
};

function obterEtapasDoEditorParaSalvar() {
    const etapasCanonicas = typeof window.obterEtapasCanonicas === 'function'
        ? window.obterEtapasCanonicas()
        : (Array.isArray(editingProduct?.etapasCanonicas) ? editingProduct.etapasCanonicas : [
            ...(Array.isArray(editingProduct?.etapas) ? editingProduct.etapas : []),
            ...(Array.isArray(editingProduct?.etapasTiktik)
                ? editingProduct.etapasTiktik
                : (Array.isArray(editingProduct?.etapastiktik) ? editingProduct.etapastiktik : [])),
        ]);

    const etapasInvalidas = etapasCanonicas.filter(etapa => {
        const liberacaoAutomatica = etapa?.fase === 'POS_OP'
            && String(etapa?.modoExecucao || etapa?.modo_execucao || '').toUpperCase() === 'LIBERACAO_AUTOMATICA';
        return !etapa?.processo || !['OP', 'POS_OP'].includes(etapa.fase) ||
            (!liberacaoAutomatica && (!Array.isArray(etapa.feitoPor) || etapa.feitoPor.length === 0));
    });

    if (etapasInvalidas.length > 0) {
        mostrarPopup('Revise as etapas: todas precisam de processo, fase e executor, ou liberaÃ§Ã£o automÃ¡tica.', 'erro');
        throw new Error('Há etapas de produção sem classificação completa.');
    }

    const etapasPosOp = etapasCanonicas.filter(etapa => etapa?.fase === 'POS_OP');
    const etapasAutomaticas = etapasPosOp.filter(etapa =>
        String(etapa?.modoExecucao || etapa?.modo_execucao || '').toUpperCase() === 'LIBERACAO_AUTOMATICA'
    );
    if (etapasAutomaticas.length > 1 || (etapasAutomaticas.length > 0 && etapasAutomaticas.length !== etapasPosOp.length)) {
        mostrarPopup('Use uma unica etapa POS_OP: todas manuais ou uma liberacao automatica.', 'erro');
        throw new Error('A configuracao POS_OP automatica nao pode ser misturada com arremates manuais.');
    }

    return {
        etapas: etapasCanonicas.filter(etapa => etapa.fase === 'OP'),
        etapastiktik: etapasCanonicas.filter(etapa => etapa.fase === 'POS_OP'),
    };
}

// --- Função Principal de Salvamento ---
async function salvarProdutoNoBackend() {
    if (!editingProduct) throw new Error('Nenhum produto para salvar.');
    if (!exigirGerenciamentoProdutos()) {
        const erroPermissao = new Error('Ação bloqueada por falta de permissão.');
        erroPermissao.permissaoBloqueada = true;
        throw erroPermissao;
    }
    editingProduct.variacoes = Array.from(elements.variationsComponentContainer.querySelectorAll('.cp-variation-row')).map(row => ({
        chave: row.querySelector('input[id^="chaveVariacao"]').value.trim(),
        valores: Array.from(row.querySelectorAll('.cp-tag')).map(tag => tag.firstChild.textContent.trim()).join(',')
    })).filter(v => v.chave);
    gradeTemp.forEach((item, idx) => {
        const skuInput = elements.gradeBody.querySelector(`tr[data-index="${idx}"] .cp-grade-sku`);
        if (skuInput) item.sku = skuInput.value.trim();
        const gtinInput = elements.gradeBody.querySelector(`tr[data-index="${idx}"] .cp-grade-gtin`);
        if (gtinInput) item.gtin = gtinInput.value.trim();
        const pacoteInput = elements.gradeBody.querySelector(`tr[data-index="${idx}"] .cp-grade-pacote`);
        if (pacoteInput) {
            const quantidade = Number.parseInt(pacoteInput.value, 10);
            item.qtd_pacote = Number.isInteger(quantidade) && quantidade > 0 ? quantidade : 1;
        }
    });
    const etapasParaSalvar = obterEtapasDoEditorParaSalvar();
    const updatedProduct = {
        ...editingProduct, // Importante para manter o ID
        nome: elements.inputProductName.value.trim(),
        sku: elements.sku.value.trim(),
        gtin: elements.gtin.value.trim(),
        unidade: elements.unidade.value,
        tipos: Array.from(document.querySelectorAll('input[name="tipo"]:checked')).map(cb => cb.value),
        imagem: elements.previewImagem.src.includes('blob.vercel-storage.com') ? elements.previewImagem.src : (editingProduct.imagem || ''),
        etapas: etapasParaSalvar.etapas,
        etapastiktik: etapasParaSalvar.etapastiktik,
        grade: deepClone(gradeTemp),
        variacoes: Array.from(elements.variationsComponentContainer.querySelectorAll('.cp-variation-row')).map(row => ({
            chave: row.querySelector('input[id^="chaveVariacao"]').value.trim(),
            valores: Array.from(row.querySelectorAll('.cp-tag')).map(tag => tag.firstChild.textContent.trim()).join(',')
        })).filter(v => v.chave)
    };
    updatedProduct.is_kit = updatedProduct.tipos.includes('kits');

    if (!updatedProduct.nome) { 
        mostrarPopup('O nome do produto é obrigatório!', 'erro');
        throw new Error('Nome do produto é obrigatório.'); 
    }

    // --- LÓGICA DE DECISÃO: POST (novo) ou PUT (existente)? ---
    const isUpdating = !!updatedProduct.id; // Se tem ID, estamos atualizando.
    const url = isUpdating ? `/api/produtos/${updatedProduct.id}` : '/api/produtos';
    const method = isUpdating ? 'PUT' : 'POST';

    try {
        const token = localStorage.getItem('token');
        const response = await fetch(url, {
            method: method, // USA O MÉTODO CORRETO
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(updatedProduct)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `Erro do servidor: ${response.status}`);
        }
        
        const savedProduct = await response.json();

        // Atualiza a lista de produtos em memória
        const index = produtos.findIndex(p => p.id === savedProduct.id);
        if (index > -1) {
            produtos[index] = savedProduct;
        } else {
            produtos.push(savedProduct);
        }

        editingProduct = deepClone(savedProduct);
        gradeTemp = deepClone(savedProduct.grade || []);
        await invalidateCache('produtos');
        return savedProduct;

    } catch (error) {
        if (!error.permissaoBloqueada) mostrarPopup('Falha ao salvar o produto: ' + error.message, 'erro');
        console.error('Erro em salvarProdutoNoBackend:', error);
        throw error;
    }
}

// --- Funções Utilitárias e Popups ---
async function handleImagemChange(event, tipo) {
    if (!exigirGerenciamentoProdutos()) {
        event.target.value = '';
        return;
    }
    const targetIndex = (tipo === 'grade') ? currentGradeIndex : null;

    const input = event.target;
    const file = input.files[0];
    if (!file) return;

    // A lógica para encontrar o elemento de pré-visualização continua a mesma
    let previewElement;
    let imageWrapper; // Para o novo controle de classe
    if (tipo === 'principal') {
        previewElement = elements.previewImagem;
        imageWrapper = document.querySelector('.cp-imagem-wrapper');
    } else if (tipo === 'grade' && targetIndex !== null) {
        const tr = elements.gradeBody.querySelector(`tr[data-index="${targetIndex}"]`);
        previewElement = tr?.querySelector('.cp-grade-img-placeholder');
    }
    
    if (!previewElement) {
        console.error("Elemento de preview não encontrado para o tipo:", tipo, "e índice:", targetIndex);
        return;
    }

    // Mostra um spinner enquanto faz o upload
    if (tipo === 'principal') {
        previewElement.parentElement.innerHTML += htmlUICarregando({ variante: 'inline', tamanho: 'sm' });
    } else {
        previewElement.innerHTML = htmlUICarregando({ variante: 'inline', tamanho: 'sm' });
    }
    
    if (tipo === 'grade') {
        fecharModalSelecaoImagem();
    }

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': file.type, 'x-filename': file.name },
            body: file,
        });

        const blobData = await response.json();
        if (!response.ok) {
            throw new Error(blobData.error || 'Falha no upload do arquivo.');
        }

        const imageUrl = blobData.url;

        // Atualiza a UI com a imagem
        if (tipo === 'principal') {
            previewElement.src = imageUrl;
            // AQUI ESTÁ A MUDANÇA: Em vez de mexer no estilo, adicionamos a classe.
            imageWrapper?.classList.add('has-image');
            if (editingProduct) editingProduct.imagem = imageUrl;

        } else if (tipo === 'grade' && targetIndex !== null) {
            previewElement.innerHTML = `<img src="${imageUrl}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">`;
            if (gradeTemp[targetIndex]) gradeTemp[targetIndex].imagem = imageUrl;
        }

        console.log("Imagem atualizada. Salvando produto para persistir a URL...");
        await salvarProdutoNoBackend();
        
        mostrarPopup('Imagem salva com sucesso!', 'sucesso');

    } catch (error) {
        console.error('Erro no processo de upload ou salvamento:', error);
        mostrarPopup(`Erro: ${error.message}`, 'erro');

        // Reverte a UI em caso de erro
        if (tipo === 'principal') {
            // AQUI ESTÁ A MUDANÇA: Revertemos removendo a classe.
            imageWrapper?.classList.remove('has-image');
            previewElement.src = '';
        } else if (tipo === 'grade' && previewElement) {
            const imagemAntiga = gradeTemp[targetIndex]?.imagem || '';
            previewElement.innerHTML = imagemAntiga ? `<img src="${imagemAntiga}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">` : '';
        }
    } finally {
        // Limpa o spinner e o valor do input de arquivo
        input.value = '';
    const spinner = document.querySelector('.cp-imagem-placeholder .ui-cg');
    spinner?.remove();
    }
}

function limparImagemPrincipal() {
    // Limpa os dados
    elements.imagemProduto.value = '';
    elements.previewImagem.src = '';
    if (editingProduct) {
        editingProduct.imagem = '';
    }

    // AQUI ESTÁ A MUDANÇA: Em vez de manipular o display de cada elemento,
    // apenas removemos a classe de estado do container principal. O CSS fará o resto.
    const wrapper = document.querySelector('.cp-imagem-wrapper');
    wrapper?.classList.remove('has-image'); // O '?' é uma segurança caso o elemento não seja encontrado
}

function handleRemoveImagem() {
    if (!exigirGerenciamentoProdutos()) return;
    limparImagemPrincipal();
}

window.switchTab = function(tabId) {
    console.log(`Tentando trocar para a aba: ${tabId}`);

    // Primeiro, desativa todas as abas e conteúdos.
    document.querySelectorAll('.cp-tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.cp-tab-content').forEach(content => content.classList.remove('active'));

    // Agora, encontra e ativa a aba e o conteúdo corretos.
    const tabButton = document.querySelector(`.cp-tab-btn[data-tab="${tabId}"]`);
    const tabContent = document.getElementById(tabId);

    // Verificações de segurança: só ativa se os elementos existirem.
    if (tabButton) {
        tabButton.classList.add('active');
        tabButton.setAttribute('aria-selected', 'true');
        console.log(`Botão da aba "${tabId}" ativado.`);
    } else {
        console.warn(`Botão para a aba "${tabId}" não foi encontrado.`);
    }

    if (tabContent) {
        tabContent.classList.add('active');
        console.log(`Conteúdo da aba "${tabId}" ativado.`);
    } else {
        console.warn(`Conteúdo com ID "${tabId}" não foi encontrado.`);
    }
};

window.toggleTabs = function() {
    const tipos = Array.from(document.querySelectorAll('input[name="tipo"]:checked')).map(cb => cb.value);
    const variacoesBtn = document.querySelector('.cp-tab-btn[data-tab="variacoes"]');
    if (tipos.includes('variacoes') || tipos.includes('kits')) {
        if (!variacoesBtn) {
            const btn = document.createElement('button');
            btn.className = 'cp-tab-btn gs-tab-btn';
            btn.dataset.tab = 'variacoes';
            btn.type = 'button';
            btn.role = 'tab';
            btn.setAttribute('aria-selected', 'false');
            btn.innerHTML = '<i class="fas fa-cubes" aria-hidden="true"></i> <span class="gs-tab-label">Variações e Grade</span>';
            elements.tabFilter.appendChild(btn);
        }
    } else if (variacoesBtn) {
        const abaAtiva = variacoesBtn.classList.contains('active');
        variacoesBtn.remove();
        // Se a aba removida era a que estava ativa, mude para a aba de dados gerais.
        if (abaAtiva) {
            switchTab('dados-gerais');
        }
    }
};

window.abrirModalSelecaoImagem = function(index) {
    if (!exigirGerenciamentoProdutos()) return;
    console.log(`%c[AÇÃO] - abrirModalSelecaoImagem foi chamada com o índice: ${index}`, 'color: blue; font-weight: bold;');
    currentGradeIndex = parseInt(index);
    const modal = document.getElementById('modalSelecionarImagem');
    const galeria = document.getElementById('galeriaImagensExistentes');
    const msgGaleriaVazia = galeria.querySelector('.cp-galeria-vazia-msg');
    msgGaleriaVazia.innerHTML = htmlUIFeedbackNotFound({
        icon: 'fa-images',
        titulo: 'Nenhuma imagem disponível',
        mensagem: 'Envie uma imagem para poder reaproveitá-la nas variações.',
    });
    galeria.innerHTML = ''; 
    galeria.appendChild(msgGaleriaVazia);

    const imagensUnicas = [...new Set(gradeTemp.map(item => item.imagem).filter(Boolean))];

    if (imagensUnicas.length > 0) {
        msgGaleriaVazia.style.display = 'none';
        imagensUnicas.forEach(url => {
            const itemAssociado = gradeTemp.find(item => item.imagem === url);
            const itemDiv = document.createElement('div');
            itemDiv.className = 'cp-galeria-item';
            itemDiv.innerHTML = `
                <img src="${url}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">
                <div class="info-overlay">${itemAssociado.variacao}</div>
            `;
            itemDiv.addEventListener('click', () => aplicarImagemExistente(url));
            galeria.appendChild(itemDiv);
        });
    } else {
        msgGaleriaVazia.style.display = 'block';
    }

    modal.classList.add('active');
}

// Função chamada quando uma imagem da galeria é clicada
function aplicarImagemExistente(imageUrl) {
    if (!exigirGerenciamentoProdutos()) return;
    if (currentGradeIndex !== null && gradeTemp[currentGradeIndex]) {
        gradeTemp[currentGradeIndex].imagem = imageUrl;
        // Salva automaticamente para persistir a mudança
        salvarProdutoNoBackend().then(() => {
            mostrarPopup('Imagem reaproveitada com sucesso!', 'sucesso');
        }).catch(err => {
            mostrarPopup('Erro ao salvar a imagem reaproveitada.', 'erro');
        });
        loadGrade(); // Atualiza a tabela na tela
        fecharModalSelecaoImagem();
    }
}

// Função para fechar o novo modal
function fecharModalSelecaoImagem() {
    const modal = document.getElementById('modalSelecionarImagem');
    if (modal) modal.classList.remove('active');
    currentGradeIndex = null;
}


// --- Funções de Estrutura, Kit e Drag-and-Drop (Completas) ---
window.addStepRow = function(processo = '', maquina = '', feitoPor = '') {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.innerHTML = `<td><span class="icone-arrastar">☰</span></td><td><select class="cp-select processo-select">${PROCESSOS.map(p => `<option value="${p}" ${p === processo ? 'selected' : ''}>${p}</option>`).join('')}</select></td><td><select class="cp-select maquina-select">${MAQUINAS.map(m => `<option value="${m}" ${m === maquina ? 'selected' : ''}>${m}</option>`).join('')}</select></td><td><select class="cp-select feito-por-select">${['costureira', 'tiktik', 'cortador'].map(t => `<option value="${t}" ${t === feitoPor ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}</select></td><td><button type="button" class="cp-remove-btn" onclick="this.parentElement.parentElement.remove()">X</button></td>`;
    elements.stepsBody.appendChild(tr);
};
window.addEtapaTiktikRow = function(processo = '', maquina = '', feitoPor = '') {
    const tr = document.createElement('tr');
    tr.draggable = true;
    tr.innerHTML = `<td><span class="icone-arrastar">☰</span></td><td><select class="cp-select processo-select">${PROCESSOS.map(p => `<option value="${p}" ${p === processo ? 'selected' : ''}>${p}</option>`).join('')}</select></td><td><select class="cp-select maquina-select">${MAQUINAS.map(m => `<option value="${m}" ${m === maquina ? 'selected' : ''}>${m}</option>`).join('')}</select></td><td><select class="cp-select feito-por-select">${['costureira', 'tiktik', 'cortador'].map(t => `<option value="${t}" ${t === feitoPor ? 'selected' : ''}>${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}</select></td><td><button type="button" class="cp-remove-btn" onclick="this.parentElement.parentElement.remove()">X</button></td>`;
    elements.etapasTiktikBody.appendChild(tr);
};
function initializeDragAndDrop() {
    [elements.stepsBody, elements.etapasTiktikBody].forEach(container => {
        let draggingEle;
        container.addEventListener('dragstart', (e) => { draggingEle = e.target; });
        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const afterElement = [...container.querySelectorAll('tr:not(.dragging)')].reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = e.clientY - box.top - box.height / 2;
                return (offset < 0 && offset > closest.offset) ? { offset: offset, element: child } : closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
            if (afterElement == null) { container.appendChild(draggingEle); } else { container.insertBefore(draggingEle, afterElement); }
        });
    });
}
// --- Catálogo de Componentes Elegíveis para Kits (Seletor Visual sem Selects) ---
let catalogoComponentesCache = [];

function getCatalogoComponentesDisponiveis() {
    const catalogo = [];
    const prodsValidos = produtos.filter(p =>
        (p.tipos?.includes('simples') || p.tipos?.includes('variacoes')) &&
        String(p.id) !== String(editingProduct?.id)
    ).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    prodsValidos.forEach(p => {
        if (Array.isArray(p.grade) && p.grade.length > 0) {
            p.grade.forEach(g => {
                const varNome = (g.variacao && g.variacao !== '-') ? g.variacao : 'Padrão';
                const imagem = g.imagem || p.imagem || '/img/placeholder-image.png';
                catalogo.push({
                    produto_id: p.id,
                    produto_nome: p.nome,
                    variacao: varNome,
                    imagem: imagem,
                    sku: g.sku || ''
                });
            });
        } else {
            catalogo.push({
                produto_id: p.id,
                produto_nome: p.nome,
                variacao: 'Padrão',
                imagem: p.imagem || '/img/placeholder-image.png',
                sku: p.sku || ''
            });
        }
    });

    return catalogo;
}

function atualizarBotaoFiltroProduto() {
    if (!elements.filtroProdLabel) return;
    if (filtroProdutoAtivo === null) {
        elements.filtroProdLabel.innerHTML = `
            <i class="fas fa-layer-group"></i>
            <span>Todos os Produtos</span>
        `;
    } else {
        const prod = produtos.find(p => String(p.id) === String(filtroProdutoAtivo));
        if (prod) {
            const img = prod.imagem || '/img/placeholder-image.png';
            elements.filtroProdLabel.innerHTML = `
                <img src="${img}" class="cp-kit-filtro-prod-thumb" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="">
                <span>${prod.nome}</span>
            `;
        } else {
            filtroProdutoAtivo = null;
            elements.filtroProdLabel.innerHTML = `
                <i class="fas fa-layer-group"></i>
                <span>Todos os Produtos</span>
            `;
        }
    }
}

function alternarDropdownFiltroProd() {
    const menu = elements.dropdownFiltroProdMenu;
    if (!menu) return;
    const isHidden = menu.style.display === 'none' || !menu.classList.contains('active');
    if (isHidden) {
        menu.style.display = 'flex';
        menu.classList.add('active');
        elements.btnDropdownFiltroProd?.setAttribute('aria-expanded', 'true');
        if (elements.inputBuscaProdDropdown) {
            elements.inputBuscaProdDropdown.value = '';
        }
        renderizarDropdownProdutos('');
        setTimeout(() => elements.inputBuscaProdDropdown?.focus(), 50);
    } else {
        fecharDropdownFiltroProd();
    }
}

function fecharDropdownFiltroProd() {
    if (elements.dropdownFiltroProdMenu) {
        elements.dropdownFiltroProdMenu.style.display = 'none';
        elements.dropdownFiltroProdMenu.classList.remove('active');
    }
    elements.btnDropdownFiltroProd?.setAttribute('aria-expanded', 'false');
}

function renderizarDropdownProdutos(termoFiltro = '') {
    const lista = elements.listaProdsDropdown;
    if (!lista) return;
    lista.innerHTML = '';

    const prodsValidos = produtos.filter(p =>
        (p.tipos?.includes('simples') || p.tipos?.includes('variacoes')) &&
        String(p.id) !== String(editingProduct?.id)
    ).sort((a, b) => (a.nome || '').localeCompare(b.nome || ''));

    const termo = (termoFiltro || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Se não filtrou por busca, inclui a opção "Todos os Produtos"
    if (!termo) {
        const itemTodos = document.createElement('button');
        itemTodos.type = 'button';
        const isActive = filtroProdutoAtivo === null;
        itemTodos.className = `cp-kit-prod-dropdown-item ${isActive ? 'active' : ''}`;
        itemTodos.innerHTML = `
            <div class="cp-kit-prod-item-left">
                <i class="fas fa-layer-group" style="width: 24px; text-align: center; font-size: 0.82rem; color: #64748b;"></i>
                <span class="cp-kit-prod-item-nome">Todos os Produtos</span>
            </div>
            <span class="cp-kit-prod-item-badge">${prodsValidos.length}</span>
        `;
        itemTodos.addEventListener('click', () => {
            filtroProdutoAtivo = null;
            atualizarBotaoFiltroProduto();
            fecharDropdownFiltroProd();
            renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
        });
        lista.appendChild(itemTodos);
    }

    const prodsFiltrados = termo
        ? prodsValidos.filter(p => {
            const nomeNorm = (p.nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const skuNorm = (p.sku || '').toLowerCase();
            return nomeNorm.includes(termo) || skuNorm.includes(termo);
        })
        : prodsValidos;

    if (prodsFiltrados.length === 0) {
        const vazio = document.createElement('div');
        vazio.style.cssText = 'padding: 12px; text-align: center; color: #94a3b8; font-size: 0.78rem;';
        vazio.innerHTML = '<i class="fas fa-search" style="margin-right: 4px;"></i> Nenhum produto encontrado';
        lista.appendChild(vazio);
        return;
    }

    prodsFiltrados.forEach(p => {
        const item = document.createElement('button');
        item.type = 'button';
        const isActive = filtroProdutoAtivo !== null && String(filtroProdutoAtivo) === String(p.id);
        item.className = `cp-kit-prod-dropdown-item ${isActive ? 'active' : ''}`;
        const qtdVariacoes = (Array.isArray(p.grade) && p.grade.length > 0) ? p.grade.length : 1;
        const img = p.imagem || '/img/placeholder-image.png';

        item.innerHTML = `
            <div class="cp-kit-prod-item-left">
                <img src="${img}" class="cp-kit-prod-item-thumb" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="">
                <span class="cp-kit-prod-item-nome" title="${p.nome}">${p.nome}</span>
            </div>
            <span class="cp-kit-prod-item-badge">${qtdVariacoes} var</span>
        `;

        item.addEventListener('click', () => {
            filtroProdutoAtivo = p.id;
            atualizarBotaoFiltroProduto();
            fecharDropdownFiltroProd();
            renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
        });

        lista.appendChild(item);
    });
}

function renderizarCatalogoComponentes(termoBusca = '') {
    const container = elements.cpKitCatalogoContainer;
    if (!container) return;
    container.innerHTML = '';

    const termo = (termoBusca || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Se NÃO digitou busca E NÃO filtrou por produto específico:
    // Mantém o estado inicial limpo (0 itens renderizados no DOM!)
    if (!termo && filtroProdutoAtivo === null) {
        container.innerHTML = `
            <div class="cp-kit-busca-prompt">
                <i class="fas fa-magnifying-glass"></i>
                <span>Digite acima para buscar variações ou selecione um produto para listar suas opções.</span>
            </div>
        `;
        return;
    }

    let itensFiltrados = catalogoComponentesCache;

    // Filtro por produto selecionado
    if (filtroProdutoAtivo !== null) {
        itensFiltrados = itensFiltrados.filter(item => String(item.produto_id) === String(filtroProdutoAtivo));
    }

    // Filtro por texto digitado
    if (termo) {
        itensFiltrados = itensFiltrados.filter(item => {
            const nomeNorm = (item.produto_nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const varNorm = (item.variacao || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const skuNorm = (item.sku || '').toLowerCase();
            return nomeNorm.includes(termo) || varNorm.includes(termo) || skuNorm.includes(termo);
        });
    }

    if (itensFiltrados.length === 0) {
        container.innerHTML = `
            <div class="cp-kit-cat-vazio">
                <i class="fas fa-search" style="font-size: 1.5rem; color: #cbd5e1;"></i>
                <span>Nenhuma variação encontrada${termoBusca ? ` para "${termoBusca}"` : ''}.</span>
            </div>
        `;
        return;
    }

    // LIMITA A NO MÁXIMO 12 ITENS NO DOM
    const MAX_EXIBIR = 12;
    const itensExibidos = itensFiltrados.slice(0, MAX_EXIBIR);

    itensExibidos.forEach((item) => {
        const itemExistente = kitComposicaoTemp.find(c =>
            (c.produto_id && String(c.produto_id) === String(item.produto_id) && c.variacao === item.variacao) ||
            (!c.produto_id && (c.produto === item.produto_nome || c.produto_nome === item.produto_nome) && c.variacao === item.variacao)
        );
        const qtdNoKit = itemExistente ? (Number(itemExistente.quantidade) || 1) : 0;

        const card = document.createElement('div');
        card.className = 'cp-kit-cat-card';
        card.title = `Clique para adicionar ${item.produto_nome} - ${item.variacao} ao kit`;
        card.innerHTML = `
            <img src="${item.imagem}" class="cp-kit-cat-thumb" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="">
            <div class="cp-kit-cat-info">
                <span class="cp-kit-cat-prod" title="${item.produto_nome}">${item.produto_nome}</span>
                <span class="cp-kit-cat-var" title="${item.variacao}">${item.variacao}</span>
            </div>
            <button type="button" class="cp-kit-cat-btn" aria-label="Adicionar ao kit">
                <i class="fas fa-plus"></i>
            </button>
            ${qtdNoKit > 0 ? `<span class="cp-kit-cat-badge-adicionado" title="${qtdNoKit} peças no kit">${qtdNoKit}</span>` : ''}
        `;

        card.addEventListener('click', () => {
            adicionarComponenteAoKit(item);
        });

        container.appendChild(card);
    });

    if (itensFiltrados.length > MAX_EXIBIR) {
        const maisInfo = document.createElement('div');
        maisInfo.className = 'cp-kit-cat-mais-info';
        maisInfo.innerHTML = `<i class="fas fa-info-circle"></i> Mostrando 12 de ${itensFiltrados.length} variações. Digite mais para refinar a busca.`;
        container.appendChild(maisInfo);
    }
}

function adicionarComponenteAoKit(comp) {
    if (!exigirGerenciamentoProdutos()) return;

    const idxExistente = kitComposicaoTemp.findIndex(c =>
        (c.produto_id && String(c.produto_id) === String(comp.produto_id) && c.variacao === comp.variacao) ||
        (!c.produto_id && (c.produto === comp.produto_nome || c.produto_nome === comp.produto_nome) && c.variacao === comp.variacao)
    );

    if (idxExistente > -1) {
        kitComposicaoTemp[idxExistente].quantidade = (Number(kitComposicaoTemp[idxExistente].quantidade) || 1) + 1;
        kitComposicaoTemp[idxExistente].produto_id = parseInt(comp.produto_id, 10);
        kitComposicaoTemp[idxExistente].produto_nome = comp.produto_nome;
    } else {
        kitComposicaoTemp.push({
            produto_id: parseInt(comp.produto_id, 10),
            produto_nome: comp.produto_nome,
            variacao: comp.variacao,
            quantidade: 1
        });
    }

    renderizarComposicaoKit();
    renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
}

function renderizarComposicaoKit() {
    const container = elements.composicaoKitContainer;
    if (!container) return;
    container.innerHTML = '';

    const totalPecas = kitComposicaoTemp.reduce((acc, c) => acc + (Number(c.quantidade) || 0), 0);
    const totalItens = kitComposicaoTemp.length;

    if (elements.cpKitResumoPecas) {
        elements.cpKitResumoPecas.innerHTML = `
            <i class="fas fa-boxes-stacked"></i>
            <span><strong>${totalPecas}</strong> peças no total (${totalItens} ${totalItens === 1 ? 'item' : 'itens'})</span>
        `;
    }

    if (kitComposicaoTemp.length === 0) {
        container.innerHTML = `
            <div class="cp-kit-comp-lista-vazia">
                <i class="fas fa-boxes-packing"></i>
                <span style="font-weight: 600; color: #475569;">Nenhum componente adicionado a este kit ainda.</span>
                <span style="font-size: 0.78rem; color: #64748b;">Clique nas variações do catálogo acima para incluir peças nesta combinação.</span>
            </div>
        `;
        return;
    }

    kitComposicaoTemp.forEach((comp, idx) => {
        const info = getComponenteInfo(comp);
        const quantidade = Number(comp.quantidade) || 1;

        const row = document.createElement('div');
        row.className = 'cp-kit-comp-item';
        row.innerHTML = `
            <div class="cp-kit-comp-item-left">
                <img src="${info.imagem}" class="cp-kit-comp-item-img" onerror="this.onerror=null;this.src='/img/placeholder-image.png';" alt="">
                <div class="cp-kit-comp-item-text">
                    <span class="cp-kit-comp-item-nome" title="${info.nome}">${info.nome}</span>
                    <span class="cp-kit-comp-item-var"><i class="fas fa-circle-dot"></i> ${info.variacao}</span>
                </div>
            </div>
            <div class="cp-kit-comp-item-right">
                <div class="cp-kit-comp-stepper">
                    <button type="button" class="cp-kit-stepper-btn" onclick="alterarQtdKit(${idx}, -1)" title="Diminuir quantidade" ${quantidade <= 1 ? 'disabled' : ''}>
                        <i class="fas fa-minus"></i>
                    </button>
                    <input type="number" min="1" max="999" class="cp-kit-stepper-input" value="${quantidade}" onchange="atualizarQuantidadeKit(${idx}, this.value)" aria-label="Quantidade">
                    <span class="cp-kit-stepper-un">un</span>
                    <button type="button" class="cp-kit-stepper-btn" onclick="alterarQtdKit(${idx}, 1)" title="Aumentar quantidade">
                        <i class="fas fa-plus"></i>
                    </button>
                </div>
                <button type="button" class="cp-kit-comp-delete-btn" onclick="removerComposicaoKit(${idx})" title="Remover este componente do kit">
                    <i class="fas fa-trash-alt"></i>
                </button>
            </div>
        `;
        container.appendChild(row);
    });
}

window.alterarQtdKit = (index, delta) => {
    if (!exigirGerenciamentoProdutos()) return;
    const item = kitComposicaoTemp[index];
    if (!item) return;
    const atual = Number(item.quantidade) || 1;
    const nova = atual + delta;
    if (nova < 1) return;
    item.quantidade = nova;
    renderizarComposicaoKit();
    renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
};

window.atualizarQuantidadeKit = (index, qty) => {
    if (!exigirGerenciamentoProdutos()) return;
    const parsed = parseInt(qty, 10);
    kitComposicaoTemp[index].quantidade = !isNaN(parsed) && parsed > 0 ? parsed : 1;
    renderizarComposicaoKit();
    renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
};

window.removerComposicaoKit = (index) => {
    if (!exigirGerenciamentoProdutos()) return;
    kitComposicaoTemp.splice(index, 1);
    renderizarComposicaoKit();
    renderizarCatalogoComponentes(elements.cpKitBuscaInput?.value || '');
};

window.abrirConfigurarVariacao = function(index) {
    if (!exigirGerenciamentoProdutos()) return;
    currentKitVariationIndex = parseInt(index, 10);
    if (isNaN(currentKitVariationIndex) || !editingProduct?.grade?.[currentKitVariationIndex]) {
        console.error("Variação de kit inválida:", index);
        return;
    }
    const variacaoKit = editingProduct.grade[currentKitVariationIndex];
    elements.configurarVariacaoTitle.textContent = `Configurar Kit: ${variacaoKit.variacao}`;
    kitComposicaoTemp = deepClone(variacaoKit.composicao || []);

    filtroProdutoAtivo = null;
    catalogoComponentesCache = getCatalogoComponentesDisponiveis();

    if (elements.cpKitBuscaInput) {
        elements.cpKitBuscaInput.value = '';
    }
    if (elements.cpKitBuscaLimpar) {
        elements.cpKitBuscaLimpar.style.display = 'none';
    }

    atualizarBotaoFiltroProduto();
    fecharDropdownFiltroProd();
    renderizarDropdownProdutos('');
    renderizarCatalogoComponentes('');
    renderizarComposicaoKit();
    elements.configurarVariacaoView.classList.add('active');
};

async function salvarComposicaoKit() {
    if (!exigirGerenciamentoProdutos()) return;
    if (currentKitVariationIndex !== null && editingProduct?.grade?.[currentKitVariationIndex]) {
        editingProduct.grade[currentKitVariationIndex].composicao = deepClone(kitComposicaoTemp);
        gradeTemp = deepClone(editingProduct.grade);
        loadGrade();
        fecharPopupConfigurarVariacao();
        await salvarProdutoNoBackend();
    }
}

function fecharPopupConfigurarVariacao() {
    fecharDropdownFiltroProd();
    const modal = document.getElementById('configurarVariacaoView');
    if (modal) modal.classList.remove('active');
    currentKitVariationIndex = null;
    kitComposicaoTemp = [];
}

// --- Ponto de Entrada ---
document.addEventListener('DOMContentLoaded', inicializarPagina);

// --- Exposição de Funções Globais para o HTML ---
Object.assign(window, {
    // Funções do formulário principal e abas
    switchTab,
    toggleTabs,
    
    // Funções da aba de variações
    addVariacaoRow,
    excluirGrade,
    updateGradeSku,
    
    // Funções dos popups
    fecharModalSelecaoImagem,
    fecharPopupConfigurarVariacao, 
    
    // Funções de Kit
    abrirConfigurarVariacao,
    adicionarComponenteAoKit,
    alterarQtdKit,
    atualizarQuantidadeKit,
    removerComposicaoKit
});
