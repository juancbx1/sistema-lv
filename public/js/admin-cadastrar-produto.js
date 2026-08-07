import { verificarAutenticacao } from '/js/utils/auth.js';
import { htmlUICarregando, removerCarregamentoInicial } from './utils/ui-carregando.js';
import { obterProdutos, invalidateCache } from '/js/utils/storage.js';
import { PRODUTOS, PRODUTOSKITS, MAQUINAS, PROCESSOS } from '/js/utils/prod-proc-maq.js';
import { htmlUIFeedbackNotFound } from './utils/ui-feedback.js';

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
    produtoKitSelect: document.getElementById('produtoKitSelect'),
    variacaoKitSelect: document.getElementById('variacaoKitSelect'),
    addVariacaoKitBtn: document.getElementById('addVariacaoKitBtn'),
    composicaoKitContainer: document.getElementById('composicaoKitContainer'),
};

let currentGradeIndex = null;
let currentKitVariationIndex = null;
let kitComposicaoTemp = [];

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
    await verificarAutenticacao('admin/cadastrar-produto.html', ['acesso-cadastrar-produto']);
    document.body.classList.add('autenticado');
    produtos = await obterProdutos(true);
    configurarEventListeners();
    
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
    document.getElementById('btnAdicionarNovoProduto')?.addEventListener('click', handleAdicionarNovoProduto);
    elements.searchProduct?.addEventListener('input', () => filterProducts());
    document.querySelectorAll('.cp-type-btn').forEach(btn => btn.addEventListener('click', () => filterProducts(btn.dataset.type)));
    
    // Formulário Principal e Abas
    document.getElementById('btnVoltarDoForm')?.addEventListener('click', () => { window.location.hash = ''; });
    elements.productForm?.addEventListener('submit', handleFormSubmit);
    elements.imagemProduto?.addEventListener('change', (event) => handleImagemChange(event, 'principal'));
    elements.removeImagem?.addEventListener('click', handleRemoveImagem);
    document.querySelectorAll('input[name="tipo"]').forEach(cb => cb.addEventListener('change', toggleTabs));

    // Aba de Produção
    document.getElementById('btnAddStep')?.addEventListener('click', () => addStepRow());
    document.getElementById('btnAddEtapaTiktik')?.addEventListener('click', () => addEtapaTiktikRow());
    document.getElementById('btnSalvarProducao')?.addEventListener('click', salvarEtapasProducao);
    initializeDragAndDrop();

    // Aba de Variações
    document.getElementById('btnAddVariacao')?.addEventListener('click', () => addVariacaoRow());
    document.getElementById('btnSalvarGrade')?.addEventListener('click', salvarGrade); 

    // Modal de Seleção de Imagem (para a grade)
    document.getElementById('btnTriggerUpload')?.addEventListener('click', () => {
        document.getElementById('gradeImageInput')?.click();
    });
    document.getElementById('gradeImageInput')?.addEventListener('change', (event) => handleImagemChange(event, 'grade'));
    document.getElementById('btnFecharModalSelecaoImagem')?.addEventListener('click', fecharModalSelecaoImagem);

    // Modal de Configuração de Kit
    document.getElementById('saveKitConfigBtn')?.addEventListener('click', salvarComposicaoKit);
    elements.addVariacaoKitBtn?.addEventListener('click', handleAddVariacaoKit);
    
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
        if (event.target.classList.contains('cp-tab-btn')) {
            switchTab(event.target.dataset.tab);
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
    // Limpa os campos de texto e inputs
    elements.editProductNameDisplay.textContent = 'Carregando...';
    elements.inputProductName.value = '';
    elements.sku.value = '';
    elements.gtin.value = '';
    elements.unidade.value = 'pç';
    elements.estoque.value = '0';
    
    // Desmarca todos os checkboxes de tipo
    document.querySelectorAll('input[name="tipo"]').forEach(cb => { cb.checked = false; });
    
    // Limpa a imagem principal
    handleRemoveImagem();

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
    try {
        document.body.style.cursor = 'wait';
        
        // A view já foi trocada pelo clique do usuário ou pelo hashchange,
        // então apenas mostramos um estado de carregamento.
        elements.editProductNameDisplay.textContent = 'Carregando produto...';
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

    // --- Preenchimento dos Dados Gerais ---
    elements.editProductNameDisplay.textContent = produto.id ? `Editando: ${produto.nome}` : 'Cadastrando Novo Produto';
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
    
    // --- Carregamento das Tabelas Dinâmicas (Etapas, Variações, Grade) ---
    // Aba de Produção (Etapas Normais)
    if (elements.stepsBody) {
        elements.stepsBody.innerHTML = ''; // Limpa antes de adicionar
        (produto.etapas || []).forEach(etapa => addStepRow(etapa.processo, etapa.maquina, etapa.feitoPor));
    }
    
    // Aba de Produção (Etapas Tiktik)
    if (elements.etapasTiktikBody) {
        elements.etapasTiktikBody.innerHTML = ''; // Limpa antes de adicionar
        // Usa a propriedade correta 'etapastiktik' (minúsculo como no seu JSON e API)
        const etapasTiktikParaCarregar = produto.etapastiktik || []; 
        etapasTiktikParaCarregar.forEach(etapa => addEtapaTiktikRow(etapa.processo, etapa.maquina, etapa.feitoPor));
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
        <button type="button" class="cp-remove-btn" onclick="removeVariacaoRow(this)">×</button>
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
        tag.remove();
        gerarCombinacoesEAtualizarGrade();
    };
    tag.appendChild(removeBtn);
    return tag;
}

window.removeVariacaoRow = function (btn) {
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
            gradeTemp.push({ variacao: novaVariacao, sku: '', imagem: '', composicao: (editingProduct?.is_kit) ? [] : ['-'] });
        }
    });
    loadGrade();
}

function loadGrade() {
    elements.gradeBody.innerHTML = '';
    const isKit = (editingProduct?.tipos || []).includes('kits');
    const headers = Array.from(elements.variationsComponentContainer.querySelectorAll('input[id^="chaveVariacao"]')).map(input => input.value.trim() || 'Variação');
    
    let headerHTML = `<tr>${headers.map(h => `<th>${h}</th>`).join('')}`;
    if (isKit) {
        headerHTML += '<th>Composto Por</th>';
    }
    headerHTML += '<th>Código (SKU)</th><th>Imagem</th><th>Ações</th></tr>';
    elements.gradeHeader.innerHTML = headerHTML;

    if (gradeTemp.length === 0 && headers.length > 0) { // Só mostra mensagem se houver variações definidas
        elements.gradeBody.innerHTML = `<tr><td colspan="${headers.length + (isKit ? 3 : 2)}">${htmlUIFeedbackNotFound({
            icon: 'fa-table-list',
            titulo: 'Nenhuma combinação gerada',
            mensagem: 'Defina os valores das variações para montar a grade.',
        })}</td></tr>`;
        return;
    }
    if (gradeTemp.length === 0 && headers.length === 0 && isKit) {
         elements.gradeBody.innerHTML = `<tr><td colspan="${(isKit ? 3 : 2)}" style="text-align:center;">Defina as variações do kit acima para gerar a grade.</td></tr>`;
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
        let rowHTML = valores.map((v, i) => `<td data-label="${headers[i] || ''}">${v}</td>`).join('');
        
        if (isKit) {
            let composicaoDisplayHtml = '';
            if (item.composicao && item.composicao.length > 0) {
                composicaoDisplayHtml = '<div class="composicao-tags">';
                item.composicao.forEach(comp => {
                    // Prioriza comp.produto_nome, fallback para comp.produto
                    const nomeComponente = comp.produto_nome || comp.produto || 'Componente Desconhecido';
                    // Pega a variação do componente. Se for nula ou '-', pode exibir 'Padrão' ou omitir.
                    const variacaoComponente = comp.variacao && comp.variacao !== '-' ? ` - ${comp.variacao}` : '';
                    const quantidadeComponente = comp.quantidade || 0;

                    // Monta a string do componente
                    composicaoDisplayHtml += `<span class="composicao-tag">${nomeComponente}${variacaoComponente} (${quantidadeComponente})</span>`;
                });
                composicaoDisplayHtml += '</div>';
            }
            // Adiciona o botão de configurar/editar
            const textoBotao = (item.composicao && item.composicao.length > 0 && item.composicao.some(c => c.produto_id || c.produto)) 
                                ? 'Editar Composição' 
                                : 'Configurar Composição';
            composicaoDisplayHtml += `<button type="button" class="cp-btn" style="margin-top: 5px;" onclick="abrirConfigurarVariacao('${idx}')">
                                        ${textoBotao}
                                     </button>`;
            rowHTML += `<td data-label="Composto Por">${composicaoDisplayHtml}</td>`;
        }
        
        rowHTML += `
            <td data-label="SKU"><input type="text" class="cp-input cp-grade-sku" value="${item.sku || ''}" onblur="updateGradeSku(${idx}, this.value)"></td>
            <td data-label="Imagem">
                <div class="cp-grade-img-placeholder" onclick="abrirModalSelecaoImagem('${idx}')" title="Editar Imagem">
                    ${item.imagem ? `<img src="${item.imagem}" onerror="this.onerror=null;this.src='/img/placeholder-image.png';">` : '<i class="fas fa-image"></i>'}
                </div>
            </td>
            <td data-label="Ações"><button type="button" class="cp-remove-btn" onclick="excluirGrade('${idx}')">X</button></td>
        `;
        tr.innerHTML = rowHTML;
        elements.gradeBody.appendChild(tr);
    });
}

window.updateGradeSku = (index, sku) => { if (gradeTemp[index]) gradeTemp[index].sku = sku.trim(); };
window.excluirGrade = (index) => {
    const idx = parseInt(index);
    if (isNaN(idx) || idx < 0 || idx >= gradeTemp.length) return;
    if (confirm(`Tem certeza que deseja excluir a variação "${gradeTemp[idx].variacao}"?`)) {
        gradeTemp.splice(idx, 1);
        loadGrade();
    }
};

window.salvarGrade = async () => {
    if (!editingProduct) return;
    try {
        await salvarProdutoNoBackend();
        alert('Grade e Variações salvas com sucesso!');
    } catch (error) { /* erro já tratado */ }
};

// --- Função Principal de Salvamento ---
async function salvarProdutoNoBackend() {
    if (!editingProduct) throw new Error('Nenhum produto para salvar.');
    editingProduct.variacoes = Array.from(elements.variationsComponentContainer.querySelectorAll('.cp-variation-row')).map(row => ({
        chave: row.querySelector('input[id^="chaveVariacao"]').value.trim(),
        valores: Array.from(row.querySelectorAll('.cp-tag')).map(tag => tag.firstChild.textContent.trim()).join(',')
    })).filter(v => v.chave);
    gradeTemp.forEach((item, idx) => {
        const skuInput = elements.gradeBody.querySelector(`tr[data-index="${idx}"] .cp-grade-sku`);
        if (skuInput) item.sku = skuInput.value.trim();
    });
    const updatedProduct = {
        ...editingProduct, // Importante para manter o ID
        nome: elements.inputProductName.value.trim(),
        sku: elements.sku.value.trim(),
        gtin: elements.gtin.value.trim(),
        unidade: elements.unidade.value,
        tipos: Array.from(document.querySelectorAll('input[name="tipo"]:checked')).map(cb => cb.value),
        imagem: elements.previewImagem.src.includes('blob.vercel-storage.com') ? elements.previewImagem.src : (editingProduct.imagem || ''),
        etapas: Array.from(elements.stepsBody.querySelectorAll('tr')).map(tr => ({
            processo: tr.querySelector('.processo-select')?.value || '', maquina: tr.querySelector('.maquina-select')?.value || '', feitoPor: tr.querySelector('.feito-por-select')?.value || ''
        })),
        etapastiktik: Array.from(elements.etapasTiktikBody.querySelectorAll('tr')).map(tr => ({
            processo: tr.querySelector('.processo-select')?.value || '', maquina: tr.querySelector('.maquina-select')?.value || '', feitoPor: tr.querySelector('.feito-por-select')?.value || ''
        })),
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
        mostrarPopup('Falha ao salvar o produto: ' + error.message, 'erro');
        console.error('Erro em salvarProdutoNoBackend:', error);
        throw error;
    }
}

// --- Funções Utilitárias e Popups ---
async function handleImagemChange(event, tipo) {
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

function handleRemoveImagem() {
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


window.switchTab = function(tabId) {
    console.log(`Tentando trocar para a aba: ${tabId}`);

    // Primeiro, desativa todas as abas e conteúdos.
    document.querySelectorAll('.cp-tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.cp-tab-content').forEach(content => content.classList.remove('active'));

    // Agora, encontra e ativa a aba e o conteúdo corretos.
    const tabButton = document.querySelector(`.cp-tab-btn[data-tab="${tabId}"]`);
    const tabContent = document.getElementById(tabId);

    // Verificações de segurança: só ativa se os elementos existirem.
    if (tabButton) {
        tabButton.classList.add('active');
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

async function loadVariacoesKit(produtoIdComponenteSelecionado) {
    // 'produtoIdComponenteSelecionado' é o ID do produto que foi escolhido no select "Produto Componente"

    elements.variacaoKitSelect.innerHTML = '<option value="">Carregando variações...</option>'; // Feedback inicial
    elements.variacaoKitSelect.disabled = true;

    if (!produtoIdComponenteSelecionado) {
        elements.variacaoKitSelect.innerHTML = '<option value="">Selecione um produto primeiro</option>';
        // Não precisa desabilitar explicitamente aqui se o estado inicial já for desabilitado
        // ou se a lógica de quando habilitar estiver correta.
        return;
    }

    try {
        // 'produtos' deve ser a sua lista completa de produtos carregada (ex: de obterProdutosDoStorage())
        // Certifique-se que 'produtos' está acessível aqui ou passe-a como argumento se necessário.
        if (!produtos || produtos.length === 0) {
            console.error("[loadVariacoesKit] Lista de produtos principal não está carregada.");
            elements.variacaoKitSelect.innerHTML = '<option value="">Erro ao carregar produtos</option>';
            return;
        }

        const produtoComponente = produtos.find(p => String(p.id) === String(produtoIdComponenteSelecionado));

        if (!produtoComponente) {
            console.warn(`[loadVariacoesKit] Produto componente com ID "${produtoIdComponenteSelecionado}" não encontrado.`);
            elements.variacaoKitSelect.innerHTML = '<option value="">Produto não encontrado</option>';
            return;
        }

        let variantesDisponiveis = [];

        // Lógica para extrair variações da GRADE do produto componente
        if (produtoComponente.grade && Array.isArray(produtoComponente.grade) && produtoComponente.grade.length > 0) {
            // Pega todas as strings de 'variacao' da grade e remove duplicatas
            variantesDisponiveis = [...new Set(produtoComponente.grade.map(g => g.variacao).filter(Boolean))].sort();
        }
        // Você pode adicionar um fallback para 'produtoComponente.variacoes' se alguns produtos simples
        // que podem ser componentes não usarem 'grade' mas sim a estrutura 'variacoes' (o que seria menos comum para componentes).
        // else if (produtoComponente.variacoes && produtoComponente.variacoes.length > 0) {
        //    // Lógica para extrair de produtoComponente.variacoes (se aplicável a componentes)
        // }


        if (variantesDisponiveis.length > 0) {
            elements.variacaoKitSelect.innerHTML = '<option value="">Selecione uma variação</option>';
            variantesDisponiveis.forEach(varianteNome => {
                elements.variacaoKitSelect.add(new Option(varianteNome, varianteNome));
            });
            elements.variacaoKitSelect.disabled = false;
        } else {
            // Se não houver variações de grade, consideramos "Padrão" como a única opção.
            // Isso é importante para produtos simples que podem ser componentes de kit.
            elements.variacaoKitSelect.innerHTML = '<option value="-">Padrão</option>'; // Usar "-" ou "" para padrão?
            // Se usar "-", seu backend/lógica de salvar precisa saber que "-" significa sem variação ou padrão.
            // Se usar "", certifique-se que isso é tratado corretamente.
            // Vou usar "-" como no seu código `loadVariacoesKit` original.
            elements.variacaoKitSelect.disabled = false; // Habilita mesmo para "Padrão"
        }

    } catch (error) {
        console.error(`[loadVariacoesKit] Erro ao carregar variações para produto ID ${produtoIdComponenteSelecionado}:`, error);
        elements.variacaoKitSelect.innerHTML = '<option value="">Erro ao carregar variações</option>';
        elements.variacaoKitSelect.disabled = true;
    }
}


window.toggleTabs = function() {
    const tipos = Array.from(document.querySelectorAll('input[name="tipo"]:checked')).map(cb => cb.value);
    let variacoesBtn = document.querySelector('.cp-tab-btn[data-tab="variacoes"]');
    if (tipos.includes('variacoes') || tipos.includes('kits')) {
    if (!variacoesBtn) {
        const btn = document.createElement('button');
        btn.className = 'cp-tab-btn';
        btn.dataset.tab = 'variacoes'; // Apenas o data-attribute é necessário
        btn.type = 'button'; // Boa prática
        btn.textContent = 'Variações e Grade';
        // NENHUM ONCLICK AQUI. A delegação de eventos vai cuidar disso.
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
window.abrirConfigurarVariacao = async function(index) { // Tornando async para usar await
    currentKitVariationIndex = parseInt(index);
    if (isNaN(currentKitVariationIndex) || !editingProduct?.grade[currentKitVariationIndex]) {
        alert('Erro: Variação de kit não encontrada.');
        return;
    }
    const variacaoKit = editingProduct.grade[currentKitVariationIndex];
    elements.configurarVariacaoTitle.textContent = `Configurar: ${variacaoKit.variacao}`;
    kitComposicaoTemp = deepClone(variacaoKit.composicao || []);

    // Popula o select de PRODUTOS componentes (o value já é o ID)
    const produtosComponentes = produtos.filter(p =>
        (p.tipos?.includes('simples') || p.tipos?.includes('variacoes')) && // Produtos que podem ser componentes
        String(p.id) !== String(editingProduct.id) // Kit não pode ser componente de si mesmo
    ).sort((a,b) => a.nome.localeCompare(b.nome));

    elements.produtoKitSelect.innerHTML = '<option value="">Selecione um produto</option>' +
        produtosComponentes.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');

    // Limpa e desabilita o select de VARIAÇÕES de componente inicialmente
    elements.variacaoKitSelect.innerHTML = '<option value="">Selecione um produto primeiro</option>';
    elements.variacaoKitSelect.disabled = true;

    // Remove listener antigo para evitar duplicação se abrirConfigurarVariacao for chamada múltiplas vezes
    const novoSelectProduto = elements.produtoKitSelect.cloneNode(true); // Clona para remover listeners
    elements.produtoKitSelect.parentNode.replaceChild(novoSelectProduto, elements.produtoKitSelect);
    elements.produtoKitSelect = novoSelectProduto; // Reatribui a referência global

    // Adiciona o listener de change para o select de Produto Componente
    elements.produtoKitSelect.addEventListener('change', async (event) => {
        const produtoIdSelecionado = event.target.value;
        await loadVariacoesKit(produtoIdSelecionado); // Chama a função para carregar as variações do componente
    });

    renderizarComposicaoKit();
    elements.configurarVariacaoView.classList.add('active');
};


window.loadVariacoesKit = function() {
    const produtoNome = elements.produtoKitSelect.value;
    const produto = produtos.find(p => p.nome === produtoNome);
    elements.variacaoKitSelect.innerHTML = '<option value="">Selecione uma variação</option>';
    if (produto?.grade?.length > 0) {
        produto.grade.forEach(g => { elements.variacaoKitSelect.innerHTML += `<option value="${g.variacao}">${g.variacao}</option>`; });
    } else {
        elements.variacaoKitSelect.innerHTML += '<option value="-">Padrão</option>';
    }
};


function handleAddVariacaoKit() {
    const produtoIdComponente = elements.produtoKitSelect.value;
    const selectElement = elements.produtoKitSelect;
    const produtoNomeComponente = selectElement.options[selectElement.selectedIndex].text;
    const variacao = elements.variacaoKitSelect.value;

    if (!produtoIdComponente || !variacao) {
        alert('Selecione produto e variação do componente.'); return;
    }

    // MUDANÇA AQUI: Ao verificar duplicatas, considere que itens antigos em kitComposicaoTemp
    // podem não ter 'produto_id' e podem ter 'produto' (nome) em vez disso.
    // Esta verificação agora é mais complexa e depende de como você quer tratar
    // a migração de componentes antigos.

    // Abordagem 1: Se um componente com o mesmo nome/variação já existe (mesmo que sem ID), avisa.
    // Isso pode ser muito restritivo se você está tentando "atualizar" um componente antigo para ter ID.
    /*
    if (kitComposicaoTemp.some(c =>
        (c.produto_id && String(c.produto_id) === String(produtoIdComponente) && c.variacao === variacao) ||
        (!c.produto_id && c.produto === produtoNomeComponente && c.variacao === variacao)
    )) {
        alert('Componente já adicionado ou um componente com o mesmo nome/variação já existe.'); return;
    }
    */

    // Abordagem 2 (Recomendada): Se você está adicionando um NOVO componente (que terá ID),
    // apenas verifique se já existe um com o MESMO ID e VARIAÇÃO.
    // Se o usuário quiser "atualizar" um componente antigo (que só tem nome), ele deve
    // primeiro remover o antigo e depois adicionar o novo com o ID.
    if (kitComposicaoTemp.some(c => c.produto_id && String(c.produto_id) === String(produtoIdComponente) && c.variacao === variacao)) {
        alert('Este componente (com ID e variação) já foi adicionado.'); return;
    }

    // Se você está tentando substituir um componente antigo que só tinha nome:
    // Primeiro, procure e remova o componente antigo se ele existir com o mesmo nome e variação.
    const indexComponenteAntigo = kitComposicaoTemp.findIndex(c =>
        !c.produto_id && // Só se não tiver ID (é um antigo)
        c.produto === produtoNomeComponente &&
        c.variacao === variacao
    );
    if (indexComponenteAntigo > -1) {
        console.log("Substituindo componente antigo (baseado em nome) por um novo com ID:", produtoNomeComponente, variacao);
        kitComposicaoTemp.splice(indexComponenteAntigo, 1);
    }


    kitComposicaoTemp.push({
        produto_id: parseInt(produtoIdComponente),
        produto_nome: produtoNomeComponente,
        variacao: variacao,
        quantidade: 1
    });
    renderizarComposicaoKit();
}


function renderizarComposicaoKit() {
    elements.composicaoKitContainer.innerHTML = '';
    kitComposicaoTemp.forEach((comp, idx) => {
        const div = document.createElement('div');
        div.className = 'composicao-kit-row';
        const quantidade = comp.quantidade || 1;
        
        // MUDANÇA AQUI: Prioriza 'produto_nome', mas usa 'produto' como fallback
        const nomeDoProdutoComponenteParaExibir = comp.produto_nome || comp.produto || 'Componente Desconhecido';
        
        div.innerHTML = `
            <span>${nomeDoProdutoComponenteParaExibir} - ${comp.variacao || 'Padrão'}</span> 
            <input type="number" class="cp-input" min="1" value="${quantidade}" onchange="atualizarQuantidadeKit(${idx}, this.value)">
            <button type="button" class="cp-remove-btn" onclick="removerComposicaoKit(${idx})">X</button>
        `;
        elements.composicaoKitContainer.appendChild(div);
    });
}


window.atualizarQuantidadeKit = (index, qty) => { kitComposicaoTemp[index].quantidade = parseInt(qty) || 1; };
window.removerComposicaoKit = (index) => { kitComposicaoTemp.splice(index, 1); renderizarComposicaoKit(); };


async function salvarComposicaoKit() {
    if (currentKitVariationIndex !== null && editingProduct.grade[currentKitVariationIndex]) {
        // kitComposicaoTemp já deve ter a estrutura { produto_id, produto_nome, variacao, quantidade }
        editingProduct.grade[currentKitVariationIndex].composicao = deepClone(kitComposicaoTemp);
        gradeTemp = deepClone(editingProduct.grade); // Atualiza gradeTemp também se você a usa em outro lugar
        loadGrade(); // Recarrega a visualização da grade principal
        
        fecharPopupConfigurarVariacao(); 
        
        await salvarProdutoNoBackend(); // Salva o produto principal com a grade atualizada
    }
}

function fecharPopupConfigurarVariacao() {
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
    
    // Funções da aba de produção
    addStepRow,
    addEtapaTiktikRow,
    
    // Funções da aba de variações
    addVariacaoRow,
    excluirGrade,
    updateGradeSku,
    
    // Funções dos popups
    fecharModalSelecaoImagem,
    fecharPopupConfigurarVariacao, 
    
    // Funções de Kit
    abrirConfigurarVariacao,
    loadVariacoesKit,
    atualizarQuantidadeKit,
    removerComposicaoKit
});
