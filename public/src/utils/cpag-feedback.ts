type FeedbackTipo = 'sucesso' | 'erro' | 'aviso' | 'info';
interface ConfirmacaoOpcoes { tipo?: FeedbackTipo | 'perigo'; textoConfirmar?: string; textoCancelar?: string; }

function removerPopup(): void { document.querySelector('.popup-container')?.remove(); }

export function mostrarConfirmacao(mensagem: string, opcoes: ConfirmacaoOpcoes = {}): Promise<boolean> {
  removerPopup();
  const container = document.createElement('div'); container.className = 'popup-container';
  const tipo = opcoes.tipo ?? 'aviso'; const confirmar = opcoes.textoConfirmar ?? 'Sim'; const cancelar = opcoes.textoCancelar ?? 'Não';
  container.innerHTML = `<div class="popup-overlay"></div><div class="popup-box popup-${tipo}"><p>${mensagem}</p><div class="popup-botoes"><button class="popup-btn popup-btn-cancelar">${cancelar}</button><button class="popup-btn popup-btn-confirmar">${confirmar}</button></div></div>`;
  document.body.appendChild(container);
  return new Promise((resolve) => {
    const fechar = (valor: boolean) => { removerPopup(); resolve(valor); };
    container.querySelector('.popup-btn-confirmar')?.addEventListener('click', () => fechar(true));
    container.querySelector('.popup-btn-cancelar')?.addEventListener('click', () => fechar(false));
    container.querySelector('.popup-overlay')?.addEventListener('click', () => fechar(false));
  });
}

const fila: Array<{ mensagem: string; tipo: FeedbackTipo; duracao: number }> = [];
let exibindo = false;
export function mostrarToast(mensagem: string, tipo: FeedbackTipo = 'info', duracao = 5000): void { fila.push({ mensagem, tipo, duracao }); processarToast(); }
function processarToast(): void {
  if (exibindo || !fila.length) return; exibindo = true;
  const item = fila.shift()!; let container = document.getElementById('toast-container-global');
  if (!container) { container = document.createElement('div'); container.id = 'toast-container-global'; container.className = 'toast-container'; document.body.appendChild(container); }
  const toast = document.createElement('div'); toast.className = `toast-notification ${item.tipo}`; const icone = item.tipo === 'sucesso' ? 'fa-check-circle' : item.tipo === 'erro' ? 'fa-times-circle' : item.tipo === 'aviso' ? 'fa-exclamation-triangle' : 'fa-info-circle'; toast.innerHTML = `<i class="fas ${icone} toast-icon"></i><div>${item.mensagem}</div>`; container.prepend(toast); setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => { toast.classList.remove('show'); toast.classList.add('hide'); setTimeout(() => { toast.remove(); exibindo = false; processarToast(); }, 500); }, item.duracao);
}
