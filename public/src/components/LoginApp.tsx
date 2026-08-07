import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { sincronizarPermissoesUsuario } from '../../js/utils/auth.js';
import UICarregando from './UICarregando';

type TelaLogin = 'formulario' | 'loading' | 'despedida';

interface BloqueioLogin {
  tentativas: number;
  bloqueadoAte: number;
}

interface UsuarioLogin {
  permissoes?: string[];
  [chave: string]: unknown;
}

interface MarcaSistemaProps {
  escura?: boolean;
}

interface EstruturaLoginProps {
  children: ReactNode;
  compacto?: boolean;
}

const ETAPAS_ACESSO: readonly string[] = [
  'Validando seu acesso',
  'Carregando seu perfil',
  'Preparando o ambiente',
];

function calcularCooldownMs(tentativas: number): number {
  const base = 30_000;
  const maximo = 4 * 60 * 60 * 1000;
  return Math.min(base * Math.pow(3, tentativas - 1), maximo);
}

function formatarTempo(ms: number): string {
  const totalSegundos = Math.ceil(ms / 1000);
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;

  if (horas > 0) return `${horas}h ${minutos.toString().padStart(2, '0')}min`;
  if (minutos > 0) return `${minutos}min ${segundos.toString().padStart(2, '0')}seg`;
  return `${segundos}seg`;
}

function salvarBloqueio(nomeUsuario: string, tentativas: number): number {
  const bloqueadoAte = Date.now() + calcularCooldownMs(tentativas);
  localStorage.setItem(
    `demitido_${nomeUsuario.toLowerCase()}`,
    JSON.stringify({ tentativas, bloqueadoAte }),
  );
  return bloqueadoAte;
}

function lerBloqueio(nomeUsuario: string): BloqueioLogin | null {
  if (!nomeUsuario) return null;

  try {
    const bloqueio = localStorage.getItem(`demitido_${nomeUsuario.toLowerCase()}`);
    if (!bloqueio) return null;

    const parsed = JSON.parse(bloqueio) as Partial<BloqueioLogin> | null;
    if (
      !parsed ||
      !Number.isFinite(parsed.tentativas) ||
      !Number.isFinite(parsed.bloqueadoAte)
    ) {
      return null;
    }

    return {
      tentativas: Number(parsed.tentativas),
      bloqueadoAte: Number(parsed.bloqueadoAte),
    };
  } catch {
    return null;
  }
}

function decidirRedirecionamento(usuario: UsuarioLogin): string {
  const permissoes = usuario.permissoes || [];
  if (permissoes.includes('acesso-admin-geral')) return '/admin/home.html';
  if (permissoes.includes('acesso-dashboard')) return '/dashboard/dashboard.html';
  return '/admin/acesso-negado.html';
}

function MarcaSistema({ escura = false }: MarcaSistemaProps) {
  return (
    <div className={`lv-marca${escura ? ' lv-marca--escura' : ''}`} aria-label="Sistema LV">
      <svg className="lv-marca-simbolo" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M8 7c0 15 2 28 8 30 8 3 13-24 9-24-5 0-4 27 3 27 5 0 9-9 12-17" />
        <path className="lv-marca-fio" d="M35 22c4-3 7-2 7 1 0 4-6 6-11 4" />
      </svg>
      <span>Sistema LV</span>
    </div>
  );
}

function PainelEditorial() {
  return (
    <section className="lv-editorial" aria-label="Ambiente de confecção">
      <div className="lv-editorial-sombra"></div>
      <div className="lv-editorial-topo">
        <MarcaSistema />
      </div>

      <div className="lv-editorial-conteudo">
        <p className="lv-editorial-sobretitulo">Pessoas <span>•</span> Processos <span>•</span> Resultados</p>
        <h1>Tudo o que fazemos começa com cuidado.</h1>
        <p className="lv-editorial-texto">
          Da primeira etapa ao último acabamento, o trabalho acontece em conjunto.
        </p>
        <svg className="lv-editorial-costura" viewBox="0 0 520 82" aria-hidden="true">
          <path d="M2 44C94 88 178 79 219 39c30-29-32-47-36-9-5 49 119 49 181 11 48-29 94-27 154-8" />
        </svg>
      </div>
    </section>
  );
}

function EstruturaLogin({ children, compacto = false }: EstruturaLoginProps) {
  return (
    <div className={`lv-root${compacto ? ' lv-root--compacto' : ''}`} id="lv-login-root">
      <main className="lv-shell">
        <PainelEditorial />
        <section className="lv-acesso">
          <div className="lv-acesso-marca-mobile">
            <MarcaSistema escura />
          </div>
          {children}
          <footer className="lv-acesso-rodape">Sistema LV <span>•</span> Gestão da produção</footer>
        </section>
      </main>
    </div>
  );
}

export default function LoginApp() {
  const [tela, setTela] = useState<TelaLogin>('formulario');
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [erroUsuario, setErroUsuario] = useState('');
  const [erroSenha, setErroSenha] = useState('');
  const [erroGeral, setErroGeral] = useState('');
  const [faseAcesso, setFaseAcesso] = useState(0);
  const [nomeDemitido, setNomeDemitido] = useState('');
  const [cooldownRestante, setCooldownRestante] = useState(0);
  const [cooldownInline, setCooldownInline] = useState(0);
  const timerCooldown = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerCooldownInline = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    (async () => {
      try {
        const response = await fetch('/api/usuarios/me', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) {
          localStorage.removeItem('token');
          return;
        }

        let usuario = (await response.json()) as UsuarioLogin;
        usuario = (await sincronizarPermissoesUsuario(usuario)) as UsuarioLogin;
        localStorage.setItem('permissoes', JSON.stringify(usuario.permissoes || []));
        window.location.href = decidirRedirecionamento(usuario);
      } catch {
        localStorage.removeItem('token');
      }
    })();
  }, []);

  useEffect(() => {
    if (timerCooldownInline.current !== null) {
      clearInterval(timerCooldownInline.current);
    }

    const bloqueio = lerBloqueio(nomeUsuario);
    if (!bloqueio || bloqueio.bloqueadoAte <= Date.now()) {
      setCooldownInline(0);
      return undefined;
    }

    setCooldownInline(bloqueio.bloqueadoAte - Date.now());
    timerCooldownInline.current = setInterval(() => {
      const bloqueioAtual = lerBloqueio(nomeUsuario);
      const restante = bloqueioAtual ? bloqueioAtual.bloqueadoAte - Date.now() : 0;

      if (restante <= 0) {
        setCooldownInline(0);
        if (timerCooldownInline.current !== null) {
          clearInterval(timerCooldownInline.current);
        }
      } else {
        setCooldownInline(restante);
      }
    }, 1000);

    return () => {
      if (timerCooldownInline.current !== null) {
        clearInterval(timerCooldownInline.current);
      }
    };
  }, [nomeUsuario]);

  useEffect(() => {
    if (tela !== 'despedida') return undefined;
    if (timerCooldown.current !== null) {
      clearInterval(timerCooldown.current);
    }

    timerCooldown.current = setInterval(() => {
      const bloqueio = lerBloqueio(nomeDemitido || nomeUsuario);
      const restante = bloqueio ? bloqueio.bloqueadoAte - Date.now() : 0;

      if (restante <= 0) {
        setCooldownRestante(0);
        if (timerCooldown.current !== null) {
          clearInterval(timerCooldown.current);
        }
      } else {
        setCooldownRestante(restante);
      }
    }, 1000);

    return () => {
      if (timerCooldown.current !== null) {
        clearInterval(timerCooldown.current);
      }
    };
  }, [tela, nomeDemitido, nomeUsuario]);

  useEffect(() => {
    if (tela !== 'loading') {
      setFaseAcesso(0);
      return undefined;
    }

    const intervalo = setInterval(() => {
      setFaseAcesso((fase) => Math.min(fase + 1, ETAPAS_ACESSO.length - 1));
    }, 700);

    return () => clearInterval(intervalo);
  }, [tela]);

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErroUsuario('');
    setErroSenha('');
    setErroGeral('');

    let possuiErro = false;
    if (!nomeUsuario.trim()) {
      setErroUsuario('Informe o nome de usuário.');
      possuiErro = true;
    }
    if (!senha) {
      setErroSenha('Informe a senha.');
      possuiErro = true;
    }
    if (possuiErro) return;

    const bloqueio = lerBloqueio(nomeUsuario);
    if (bloqueio && bloqueio.bloqueadoAte > Date.now()) return;

    setTela('loading');

    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeUsuario: nomeUsuario.trim(), senha }),
      });

      if (response.status === 403) {
        const dados = await response.json().catch(() => ({}));
        if (dados.error === 'CONTRATO_ENCERRADO') {
          const bloqueioAtual = lerBloqueio(nomeUsuario);
          const tentativas = (bloqueioAtual?.tentativas || 0) + 1;
          const bloqueadoAte = salvarBloqueio(nomeUsuario, tentativas);
          setNomeDemitido(dados.nome || nomeUsuario);
          setCooldownRestante(bloqueadoAte - Date.now());
          setTela('despedida');
          return;
        }

        setTela('formulario');
        setErroGeral(
          dados.error === 'CONTA_INATIVA'
            ? 'Esta conta está inativa. Procure a gestão.'
            : 'Seu acesso não está disponível. Procure a gestão.',
        );
        return;
      }

      if (!response.ok) {
        const dados = await response.json().catch(() => ({}));
        setTela('formulario');
        if (response.status === 401) {
          setErroSenha('Usuário ou senha incorretos.');
        } else {
          setErroGeral(dados.error || 'Não foi possível entrar. Tente novamente.');
        }
        return;
      }

      const { token } = (await response.json()) as { token: string };
      localStorage.setItem('token', token);

      const perfilResponse = await fetch('/api/usuarios/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!perfilResponse.ok) throw new Error('Erro ao carregar perfil.');

      let usuario = (await perfilResponse.json()) as UsuarioLogin;
      usuario = (await sincronizarPermissoesUsuario(usuario)) as UsuarioLogin;
      localStorage.setItem('permissoes', JSON.stringify(usuario.permissoes || []));

      document.getElementById('lv-login-root')?.classList.add('lv-fadeout');
      setTimeout(() => {
        window.location.href = decidirRedirecionamento(usuario);
      }, 350);
    } catch (error) {
      console.error('[Login] Erro:', error);
      setTela('formulario');
      setErroGeral('Erro no servidor. Tente novamente em instantes.');
    }
  }, [nomeUsuario, senha]);

  if (tela === 'loading') {
    return (
      <EstruturaLogin compacto>
        <div className="lv-estado lv-estado--loading" role="status" aria-live="polite">
          <UICarregando variante="bloco" tamanho="md" texto="Preparando seu acesso..." />
          <h2>Estamos preparando tudo.</h2>
          <p>Só mais um instante para acessar seu ambiente.</p>
          <div className="lv-loading-etapas">
            {ETAPAS_ACESSO.map((etapa, indice) => (
              <div
                className={`lv-loading-etapa${
                  indice === faseAcesso
                    ? ' lv-loading-etapa--ativa'
                    : indice < faseAcesso
                      ? ' lv-loading-etapa--concluida'
                      : ''
                }`}
                key={etapa}
              >
                <span>{indice < faseAcesso ? <i className="fas fa-check"></i> : indice + 1}</span>
                {etapa}
              </div>
            ))}
          </div>
        </div>
      </EstruturaLogin>
    );
  }

  if (tela === 'despedida') {
    return (
      <EstruturaLogin compacto>
        <div className="lv-estado lv-estado--despedida">
          <div className="lv-despedida-icone" aria-hidden="true">
            <i className="fas fa-link-slash"></i>
          </div>
          <p className="lv-estado-sobretitulo">Vínculo encerrado</p>
          <h2>Até logo{nomeDemitido ? `, ${nomeDemitido.split(' ')[0]}` : ''}.</h2>
          <p>
            Seu vínculo de acesso foi encerrado. Se precisar de documentos ou tiver alguma dúvida,
            procure a gestão responsável.
          </p>

          {cooldownRestante > 0 && (
            <div className="lv-aviso lv-aviso--neutro">
              <i className="fas fa-clock" aria-hidden="true"></i>
              <span>
                Outra tentativa estará disponível em <strong>{formatarTempo(cooldownRestante)}</strong>.
              </span>
            </div>
          )}

          <button
            className="lv-btn-secundario"
            type="button"
            onClick={() => {
              setNomeUsuario('');
              setSenha('');
              setErroUsuario('');
              setErroSenha('');
              setErroGeral('');
              setTela('formulario');
            }}
          >
            <i className="fas fa-arrow-left" aria-hidden="true"></i>
            Entrar com outra conta
          </button>
        </div>
      </EstruturaLogin>
    );
  }

  return (
    <EstruturaLogin>
      <div className="lv-formulario-wrap">
        <div className="lv-formulario-cabecalho">
          <svg className="lv-fio-icone" viewBox="0 0 64 64" aria-hidden="true">
            <path d="M13 18c17-17 30 4 16 15-12 9-20-5-8-12 15-9 31 10 17 24-7 7-16 6-23 2" />
            <path d="M36 46l10-8" />
          </svg>
          <h2>Bom ter você por aqui.</h2>
          <p>Entre para continuar sua jornada no Sistema LV.</p>
        </div>

        <form className="lv-formulario" onSubmit={handleSubmit} noValidate>
          <div className={`lv-campo${erroUsuario ? ' lv-campo--erro' : ''}`}>
            <label htmlFor="lv-usuario">Usuário</label>
            <div className="lv-input-wrap">
              <i className="far fa-user" aria-hidden="true"></i>
              <input
                id="lv-usuario"
                type="text"
                autoComplete="username"
                placeholder="Digite seu usuário"
                value={nomeUsuario}
                onChange={(event) => {
                  setNomeUsuario(event.target.value);
                  setErroUsuario('');
                }}
                autoFocus
              />
            </div>
            {erroUsuario && <span className="lv-campo-erro">{erroUsuario}</span>}
          </div>

          <div className={`lv-campo${erroSenha ? ' lv-campo--erro' : ''}`}>
            <label htmlFor="lv-senha">Senha</label>
            <div className="lv-input-wrap">
              <i className="fas fa-lock" aria-hidden="true"></i>
              <input
                id="lv-senha"
                type={mostrarSenha ? 'text' : 'password'}
                autoComplete="current-password"
                placeholder="Digite sua senha"
                value={senha}
                onChange={(event) => {
                  setSenha(event.target.value);
                  setErroSenha('');
                }}
              />
              <button
                className="lv-mostrar-senha"
                type="button"
                aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
                onClick={() => setMostrarSenha((visivel) => !visivel)}
              >
                <i className={`far ${mostrarSenha ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true"></i>
              </button>
            </div>
            {erroSenha && <span className="lv-campo-erro">{erroSenha}</span>}
          </div>

          {erroGeral && (
            <div className="lv-aviso lv-aviso--erro" role="alert">
              <i className="fas fa-circle-exclamation" aria-hidden="true"></i>
              <span>{erroGeral}</span>
            </div>
          )}

          {cooldownInline > 0 && (
            <div className="lv-aviso lv-aviso--neutro" role="status">
              <i className="fas fa-clock" aria-hidden="true"></i>
              <span>
                Acesso temporariamente suspenso. Tente novamente em{' '}
                <strong>{formatarTempo(cooldownInline)}</strong>.
              </span>
            </div>
          )}

          <button className="lv-btn-entrar" type="submit" disabled={cooldownInline > 0}>
            <span>Entrar</span>
            <i className="fas fa-arrow-right" aria-hidden="true"></i>
          </button>

          <div className="lv-seguranca">
            <i className="fas fa-shield-halved" aria-hidden="true"></i>
            Ambiente interno e seguro
          </div>
        </form>
      </div>
    </EstruturaLogin>
  );
}
