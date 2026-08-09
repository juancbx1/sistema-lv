import type { MenuEmpresa } from '../utils/menu-types';
import type { HomeUsuario } from '../utils/home-types';

interface HOMEHeaderProps {
  usuario: HomeUsuario;
  empresa?: MenuEmpresa;
  quantidadeFerramentas: number;
  onAbrirComandos: () => void;
  onIrParaNovidades: () => void;
}

function saudacaoAtual() {
  const hora = new Date().getHours();
  if (hora < 12) return 'Bom dia';
  if (hora < 18) return 'Boa tarde';
  return 'Boa noite';
}

function dataPorExtenso() {
  const valor = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date());
  return valor.charAt(0).toUpperCase() + valor.slice(1);
}

export default function HOMEHeader({
  usuario,
  empresa,
  quantidadeFerramentas,
  onAbrirComandos,
  onIrParaNovidades,
}: HOMEHeaderProps) {
  const primeiroNome = usuario.nome?.trim().split(/\s+/)[0] || 'bem-vindo';
  const empresaNome = empresa?.nome_fantasia || empresa?.razao_social || 'Empresa ativa';

  return (
    <header className="home-hero">
      <span className="home-hero-orb home-hero-orb-one" aria-hidden="true" />
      <span className="home-hero-orb home-hero-orb-two" aria-hidden="true" />

      <div className="home-hero-copy">
        <div className="home-eyebrow">
          <span className="home-live-dot" aria-hidden="true" />
          Seu espaço de trabalho
        </div>
        <h1>
          {saudacaoAtual()}, <span>{primeiroNome}</span>.
        </h1>
        <p>Organize o dia, encontre qualquer área e retome o trabalho sem perder tempo.</p>

        <div className="home-hero-actions">
          <button className="home-button home-button-primary" type="button" onClick={onAbrirComandos}>
            <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
            Buscar no sistema
            <kbd>Ctrl K</kbd>
          </button>
          <button className="home-button home-button-ghost" type="button" onClick={onIrParaNovidades}>
            <i className="fa-solid fa-sparkles" aria-hidden="true" />
            Ver novidades
          </button>
        </div>
      </div>

      <div className="home-hero-context" aria-label="Contexto atual">
        <div className="home-context-date">
          <span><i className="fa-regular fa-calendar" aria-hidden="true" /></span>
          <div>
            <small>Hoje</small>
            <strong>{dataPorExtenso()}</strong>
          </div>
        </div>
        <div className="home-context-company">
          <span
            className="home-company-mark"
            style={{ '--home-company-color': empresa?.cor_identificacao || '#2563eb' } as React.CSSProperties}
          >
            {empresaNome.charAt(0).toUpperCase()}
          </span>
          <div>
            <small>Empresa selecionada</small>
            <strong>{empresaNome}</strong>
          </div>
        </div>
        <div className="home-context-tools">
          <strong>{quantidadeFerramentas}</strong>
          <span>áreas disponíveis para você</span>
        </div>
      </div>
    </header>
  );
}
