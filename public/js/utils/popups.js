/* public/js/utils/popups.js */

import urlSomAlerta from '/sounds/alerta.mp3'; // Importa o som aqui


const filaDeToasts = [];
let toastEmExibicao = false;
let audioContextDesbloqueado = false;
const audioAlertaParaDesbloqueio = new Audio(urlSomAlerta);

/**
 * Tenta "desbloquear" a permissão de áudio, se ainda não tiver sido feito.
 * Esta função deve ser chamada após a primeira interação do usuário com qualquer popup.
 */
function desbloquearAudioContext() {
    if (audioContextDesbloqueado) return;

    audioAlertaParaDesbloqueio.muted = true;
    audioAlertaParaDesbloqueio.play().then(() => {
        audioAlertaParaDesbloqueio.pause();
        audioAlertaParaDesbloqueio.currentTime = 0;
        audioAlertaParaDesbloqueio.muted = false;
        audioContextDesbloqueado = true;
        console.log('[ÁUDIO POPUP] Contexto de áudio desbloqueado com sucesso.');
    }).catch(() => {
        // Falha silenciosa no console, não incomoda o usuário
    });
}



/**
 * Remove qualquer popup existente da tela com uma animação suave.
 */
function removerPopupExistente() {
    const containerExistente = document.querySelector('.popup-container');
    if (containerExistente) {
        const popupBox = containerExistente.querySelector('.popup-box');
        const overlay = containerExistente.querySelector('.popup-overlay');
        
        if (popupBox) popupBox.style.animation = 'popup-slide-out 0.3s ease-out forwards';
        if (overlay) overlay.style.animation = 'popup-fade-out 0.3s ease-out forwards';
        
        setTimeout(() => {
            containerExistente.remove();
        }, 300);
    }
}


/**
 * Exibe uma mensagem simples para o usuário com um botão "OK".
 * @param {string} mensagem - O texto a ser exibido.
 * @param {'sucesso'|'erro'|'aviso'|'info'} [tipo='info'] - O tipo de popup (controla a cor da borda).
 * @param {number} [duracao=0] - Tempo em milissegundos para fechar automaticamente. 0 para não fechar.
 */
export function mostrarMensagem(mensagem, tipo = 'info', duracao = 0) {
    removerPopupExistente();

    const container = document.createElement('div');
    container.className = 'popup-container';

    container.innerHTML = `
        <div class="popup-overlay"></div>
        <div class="popup-box popup-${tipo}">
            <p>${mensagem}</p>
            <div class="popup-botoes">
                <button class="popup-btn popup-btn-ok">OK</button>
            </div>
        </div>
    `;

    document.body.appendChild(container);

    const btnOk = container.querySelector('.popup-btn-ok');
    const overlay = container.querySelector('.popup-overlay');

    const fecharPopup = () => removerPopupExistente();

    btnOk.onclick = fecharPopup;
    overlay.onclick = fecharPopup;

    if (duracao > 0) {
        setTimeout(fecharPopup, duracao);
    }
}


/**
 * Exibe um popup de confirmação e retorna uma Promise.
 * @param {string} mensagem - A pergunta a ser exibida.
 * @param {object} [opcoes={}] - Opções de configuração.
 * @param {'perigo'|'aviso'|'sucesso'|'info'} [opcoes.tipo='aviso'] - O tipo de popup.
 * @param {string} [opcoes.textoConfirmar='Sim'] - O texto para o botão de confirmação.
 * @param {string} [opcoes.textoCancelar='Não'] - O texto para o botão de cancelar.
 * @returns {Promise<boolean>} - true se o usuário confirmar, false se cancelar.
 */
export function mostrarConfirmacao(mensagem, opcoes = {}) {
    removerPopupExistente();
    
    // Define os valores padrão se não forem fornecidos
    const { tipo = 'aviso', textoConfirmar = 'Sim', textoCancelar = 'Não' } = opcoes;

    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'popup-container';

        container.innerHTML = `
            <div class="popup-overlay"></div>
            <div class="popup-box popup-${tipo}">
                <p>${mensagem}</p>
                <div class="popup-botoes">
                    <button class="popup-btn popup-btn-cancelar">${textoCancelar}</button>
                    <button class="popup-btn popup-btn-confirmar">${textoConfirmar}</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const btnConfirmar = container.querySelector('.popup-btn-confirmar');
        const btnCancelar = container.querySelector('.popup-btn-cancelar');
        const overlay = container.querySelector('.popup-overlay');

        const fecharPopup = (valorResolvido) => {
            desbloquearAudioContext();

            removerPopupExistente();
            resolve(valorResolvido);
        };
        
        btnConfirmar.onclick = () => fecharPopup(true);
        btnCancelar.onclick = () => fecharPopup(false);
        overlay.onclick = () => fecharPopup(false);
    });
}

/**
 * Exibe um popup para inserção de um valor numérico e retorna uma Promise.
 * A Promise resolve para o número inserido ou para null se o usuário cancelar.
 * @param {string} mensagem - A pergunta a ser exibida.
 * @param {object} [opcoes={}] - Opções de configuração.
 * @param {string} [opcoes.valorInicial=''] - O valor inicial do campo de input.
 * @param {string} [opcoes.placeholder=''] - O placeholder do campo.
 * @param {string} [opcoes.tipo='info'] - O tipo de popup para a cor da borda.
 * @returns {Promise<number|null>} - O número inserido ou null.
 */
export function mostrarPromptNumerico(mensagem, opcoes = {}) {
    removerPopupExistente();
    const { valorInicial = '', placeholder = 'Qtd.', tipo = 'info' } = opcoes;

    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'popup-container';

        container.innerHTML = `
            <div class="popup-overlay"></div>
            <div class="popup-box popup-${tipo}">
                <p>${mensagem}</p>
                <div class.popup-input-container">
                    <input type="number" id="popupInputNumerico" class="popup-input-numerico" 
                           value="${valorInicial}" placeholder="${placeholder}" min="0">
                </div>
                <div class="popup-botoes">
                    <button class="popup-btn popup-btn-cancelar">Cancelar</button>
                    <button id="popupBtnConfirmarNumerico" class="popup-btn popup-btn-confirmar">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const input = container.querySelector('#popupInputNumerico');
        const btnConfirmar = container.querySelector('#popupBtnConfirmarNumerico');
        const btnCancelar = container.querySelector('.popup-btn-cancelar');
        const overlay = container.querySelector('.popup-overlay');

        const fecharPopup = (valor) => {
            removerPopupExistente();
            resolve(valor);
        };

        // Validação em tempo real
        input.addEventListener('input', () => {
            const valor = parseInt(input.value);
            btnConfirmar.disabled = isNaN(valor) || valor < 0;
        });

        btnConfirmar.onclick = () => {
            const valor = parseInt(input.value);
            if (!isNaN(valor) && valor >= 0) {
                fecharPopup(valor);
            }
        };

        // Permite confirmar com a tecla Enter
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !btnConfirmar.disabled) {
                btnConfirmar.click();
            }
        });

        btnCancelar.onclick = () => fecharPopup(null);
        overlay.onclick = () => fecharPopup(null);

        input.focus();
        input.select(); // Seleciona o texto inicial para fácil substituição
    });
}

/**
 * Exibe um popup com um campo de texto para justificativas ou outros inputs.
 * @param {string} mensagem - A pergunta a ser exibida.
 * @param {object} [opcoes={}] - Opções de configuração.
 * @param {string} [opcoes.placeholder=''] - O placeholder do campo de texto.
 * @param {string} [opcoes.tipo='info'] - O tipo de popup para a cor da borda.
 * @param {string} [opcoes.textoConfirmar='Confirmar'] - Texto do botão de confirmação.
 * @param {string} [opcoes.valorInicial=''] - Texto inicial selecionado para edição.
 * @returns {Promise<string|null>} - O texto inserido ou null se o usuário cancelar.
 */
export function mostrarPromptTexto(mensagem, opcoes = {}) {
    removerPopupExistente();
    const {
        placeholder = '',
        tipo = 'info',
        textoConfirmar = 'Confirmar',
        valorInicial = '',
    } = opcoes;

    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'popup-container';

        container.innerHTML = `
            <div class="popup-overlay"></div>
            <div class="popup-box popup-${tipo}">
                <p>${mensagem}</p>
                <div class="popup-input-container" style="margin-bottom: 20px;">
                    <textarea id="popupInputTexto" class="popup-input-texto" 
                              placeholder="${placeholder}" rows="3"></textarea>
                </div>
                <div class="popup-botoes">
                    <button class="popup-btn popup-btn-cancelar">Cancelar</button>
                    <button id="popupBtnConfirmarTexto" class="popup-btn popup-btn-confirmar">${textoConfirmar}</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const textarea = container.querySelector('#popupInputTexto');
        const btnConfirmar = container.querySelector('#popupBtnConfirmarTexto');
        const btnCancelar = container.querySelector('.popup-btn-cancelar');
        const overlay = container.querySelector('.popup-overlay');

        if (valorInicial) {
            textarea.value = valorInicial;
            // Seleciona o texto para facilitar a edição (mesmo comportamento do prompt nativo)
            textarea.select();
        }

        const fecharPopup = (valor) => {
            removerPopupExistente();
            resolve(valor);
        };
        
        btnConfirmar.onclick = () => fecharPopup(textarea.value.trim());
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { // Permite Shift+Enter para nova linha
                e.preventDefault();
                btnConfirmar.click();
            }
        });
        btnCancelar.onclick = () => fecharPopup(null);
        overlay.onclick = () => fecharPopup(null);

        if (!valorInicial) textarea.focus();
    });
}

/**
 * Exibe um popup customizado para finalizar tarefas em lote, com inputs por produto.
 * @param {string} mensagem - A mensagem principal a ser exibida.
 * @param {Array<object>} sessoes - O array de sessões que compõem o lote.
 * @returns {Promise<object|null>} - Um objeto com o total e os detalhes por sessão, ou null se cancelado.
 */
/**
 * Exibe um popup para o usuário inserir um horário (input type="time").
 * @param {string} mensagem - A mensagem principal.
 * @param {object} [opcoes={}]
 * @param {string} [opcoes.valorInicial=''] - Horário pré-preenchido (HH:MM).
 * @param {string} [opcoes.tipo='info'] - Tipo de popup para a cor da borda.
 * @param {string} [opcoes.textoConfirmar='Confirmar'] - Texto do botão de confirmação.
 * @returns {Promise<string|null>} - O horário no formato 'HH:MM' ou null se cancelado.
 */
export function mostrarPromptHorario(mensagem, opcoes = {}) {
    removerPopupExistente();
    const { valorInicial = '', tipo = 'info', textoConfirmar = 'Confirmar' } = opcoes;

    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'popup-container';

        container.innerHTML = `
            <div class="popup-overlay"></div>
            <div class="popup-box popup-${tipo}">
                <p>${mensagem}</p>
                <div class="popup-input-container" style="margin-bottom: 20px;">
                    <input type="time" id="popupInputHorario" class="popup-input-numerico"
                           value="${valorInicial}" style="width: 100%; padding: 8px; font-size: 1rem;" />
                </div>
                <div class="popup-botoes">
                    <button class="popup-btn popup-btn-cancelar">Cancelar</button>
                    <button id="popupBtnConfirmarHorario" class="popup-btn popup-btn-confirmar">${textoConfirmar}</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const input = container.querySelector('#popupInputHorario');
        const btnConfirmar = container.querySelector('#popupBtnConfirmarHorario');
        const btnCancelar = container.querySelector('.popup-btn-cancelar');
        const overlay = container.querySelector('.popup-overlay');

        const fecharPopup = (valor) => {
            removerPopupExistente();
            resolve(valor);
        };

        btnConfirmar.onclick = () => {
            const val = input.value.trim();
            if (!val) return;
            fecharPopup(val);
        };
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); btnConfirmar.click(); }
        });
        btnCancelar.onclick = () => fecharPopup(null);
        overlay.onclick = () => fecharPopup(null);

        input.focus();
    });
}

export function mostrarPromptFinalizarLote(mensagem, sessoes) {
    removerPopupExistente();

    return new Promise((resolve) => {
        const container = document.createElement('div');
        container.className = 'popup-container';

        // Cria a lista de inputs para cada produto/sessão no lote
        const inputsHTML = sessoes.map(sessao => `
            <div class="popup-lote-item">
                <label for="lote-input-${sessao.id_sessao}">
                    ${sessao.produto_nome} (${sessao.variante || 'Padrão'})
                    <small>Entregue: ${sessao.quantidade_entregue}</small>
                </label>
                <input 
                    type="number" 
                    id="lote-input-${sessao.id_sessao}" 
                    class="popup-input-numerico lote-input"
                    data-sessao-id="${sessao.id_sessao}"
                    data-max-qtd="${sessao.quantidade_entregue}"
                    value="${sessao.quantidade_entregue}" 
                    min="0" 
                    max="${sessao.quantidade_entregue}"
                >
            </div>
        `).join('');

        container.innerHTML = `
            <div class="popup-overlay"></div>
            <div class="popup-box popup-info" style="max-width: 500px;">
                <p>${mensagem}</p>
                <div class="popup-lote-container">${inputsHTML}</div>
                <div class="popup-lote-total">
                    <strong>Total Finalizado:</strong>
                    <span id="popupLoteTotal">0</span>
                </div>
                <div class="popup-botoes">
                    <button class="popup-btn popup-btn-cancelar">Cancelar</button>
                    <button id="popupBtnConfirmarLote" class="popup-btn popup-btn-confirmar">Confirmar</button>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const inputs = container.querySelectorAll('.lote-input');
        const totalEl = container.querySelector('#popupLoteTotal');
        const btnConfirmar = container.querySelector('#popupBtnConfirmarLote');
        const btnCancelar = container.querySelector('.popup-btn-cancelar');
        const overlay = container.querySelector('.popup-overlay');

        function calcularTotal() {
            let total = 0;
            let isValido = true;
            inputs.forEach(input => {
                const valor = parseInt(input.value) || 0;
                const max = parseInt(input.dataset.maxQtd);
                if (valor < 0 || valor > max) {
                    input.style.borderColor = 'red';
                    isValido = false;
                } else {
                    input.style.borderColor = '';
                }
                total += valor;
            });
            totalEl.textContent = total;
            btnConfirmar.disabled = !isValido;
        }

        inputs.forEach(input => input.addEventListener('input', calcularTotal));
        
        const fecharPopup = (valor) => {
            removerPopupExistente();
            resolve(valor);
        };
        
        btnConfirmar.onclick = () => {
            let totalFinalizado = 0;
            const detalhes = [];
            inputs.forEach(input => {
                const quantidade = parseInt(input.value) || 0;
                totalFinalizado += quantidade;
                detalhes.push({
                    id_sessao: parseInt(input.dataset.sessaoId),
                    quantidade_finalizada: quantidade,
                });
            });
            fecharPopup({ total: totalFinalizado, detalhes });
        };

        btnCancelar.onclick = () => fecharPopup(null);
        overlay.onclick = () => fecharPopup(null);

        calcularTotal(); // Calcula o total inicial
    });
}

export function mostrarToast(mensagem, tipo = 'info', duracao = 5000) {
    // A função 'mostrarToast' apenas adiciona o trabalho à fila
    filaDeToasts.push({ mensagem, tipo, duracao });
    // E tenta iniciar o processamento
    processarFilaDeToasts();
}

function processarFilaDeToasts() {
    // Se um toast já está na tela, ou a fila está vazia, não faz nada.
    if (toastEmExibicao || filaDeToasts.length === 0) {
        return;
    }

    // "Fecha o semáforo" para bloquear novos toasts
    toastEmExibicao = true;
    
    // Pega o próximo da fila
    const toastParaMostrar = filaDeToasts.shift();
    const { mensagem, tipo, duracao } = toastParaMostrar;

    let container = document.getElementById('toast-container-global');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container-global';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    // A classe customizada é aplicada aqui
    toast.className = `toast-notification ${tipo}`;
    
    // O ícone customizado é definido aqui
    let iconClass = 'fa-info-circle';
    if (tipo === 'sucesso') iconClass = 'fa-check-circle';
    if (tipo === 'erro') iconClass = 'fa-times-circle';
    if (tipo === 'aviso') iconClass = 'fa-exclamation-triangle';

    toast.innerHTML = `
        <i class="fas ${iconClass} toast-icon"></i>
        <div>${mensagem}</div>
    `;

    container.prepend(toast);

    // Animação de entrada
    setTimeout(() => toast.classList.add('show'), 10);

    // Animação de saída, usando a 'duração' customizada
    setTimeout(() => {
        toast.classList.remove('show');
        toast.classList.add('hide');
        
        setTimeout(() => {
            toast.remove();
            // "Abre o semáforo" para o próximo toast
            toastEmExibicao = false;
            // Tenta processar o próximo da fila
            processarFilaDeToasts();
        }, 500);
    }, duracao);
}
