// public/src/components/UIBloqueio.tsx
// Wrapper React do padrão universal de bloqueio visual.
//
// REGRA DO SISTEMA: nunca sumir com elementos por falta de permissão.
// Usar este componente para mostrar o elemento em estado bloqueado (com cadeado)
// e exibir o popup padrão ao clicar.
//
// ── QUANDO USAR ──────────────────────────────────────────────────────────────
//
// PADRÃO WRAPPER (este componente) — para elementos em fluxo normal (flex/block):
//   <UIBloqueio permissao="finalizar-op">
//       <button onClick={handleFinalizar}>Finalizar OP</button>
//   </UIBloqueio>
//
// PADRÃO INLINE — para elementos position:absolute (ex: botões flutuantes no card):
//   ❌ NÃO use UIBloqueio — o wrapper cria position:relative que destrói o
//      contexto de posicionamento CSS do filho.
//   ✅ USE diretamente no handler:
//       import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio';
//       const podeExecutar = temPermissao('cancelar-op');
//       const handleClick = (e) => {
//           e.stopPropagation();
//           if (!podeExecutar) { mostrarPopupSemPermissao(); return; }
//           // ... lógica real
//       };
//       // No JSX: troca o ícone quando bloqueado
//       <button onClick={handleClick}>
//           <i className={`fas ${podeExecutar ? 'fa-trash-alt' : 'fa-lock'}`}></i>
//       </button>
//
// Com mensagem customizada:
//   <UIBloqueio permissao="cancelar-op" mensagem="Apenas administradores podem cancelar OPs.">
//       <button>Cancelar</button>
//   </UIBloqueio>
//
// ── NOTAS DE LAYOUT ──────────────────────────────────────────────────────────
// O wrapper usa display:inline-flex para se ajustar ao tamanho exato do filho.
// Isso preserva o comportamento do container pai (flex, grid, etc.) sem ocupar
// largura extra. NÃO existe variante "bloco" — se o filho precisar de largura
// total, coloque o style/classe nele (ex: style={{ width: '100%' }}).

import { useMemo, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import {
    temPermissao,
    mostrarPopupSemPermissao,
    mostrarPopupPaginaBloqueada,
    navegarParaAcessoNegado,
} from '../utils/bloqueio';

interface UIBloqueioProps {
    permissao: string | readonly string[];
    mensagem?: string;
    pagina?: string;
    tipoBloqueio?: 'permissao' | 'modulo';
    modoBloqueio?: 'popup' | 'pagina';
    destinoBloqueio?: 'acesso-negado' | 'home';
    bloqueado?: boolean;
    style?: CSSProperties;
    children: ReactNode;
}

export default function UIBloqueio({
    permissao,
    mensagem,
    pagina,
    tipoBloqueio = 'permissao',
    modoBloqueio = 'popup',
    destinoBloqueio = 'acesso-negado',
    bloqueado: bloqueadoProp,
    style,
    children,
}: UIBloqueioProps) {
    const bloqueado = useMemo(
        () => bloqueadoProp ?? !temPermissao(permissao),
        [bloqueadoProp, permissao],
    );

    // Com permissão: renderiza os filhos sem nenhuma alteração
    if (!bloqueado) return children;

    const handleClick = (e: MouseEvent<HTMLDivElement>) => {
        e.stopPropagation();
        e.preventDefault();
        const mensagemFinal = mensagem || (
            tipoBloqueio === 'modulo'
                ? 'Este módulo ainda não está disponível para a empresa ativa.'
                : 'Você não tem permissão para acessar esta página.'
        );

        if (modoBloqueio === 'pagina') {
            if (destinoBloqueio === 'home') {
                mostrarPopupPaginaBloqueada(
                    pagina || document.title || 'Área protegida',
                    mensagemFinal,
                );
                return;
            }
            navegarParaAcessoNegado({
                pagina: pagina || document.title || 'Área protegida',
                permissoes: Array.isArray(permissao) ? permissao : [permissao],
                motivo: tipoBloqueio,
                mensagem: mensagemFinal,
            });
            return;
        }

        mostrarPopupSemPermissao(mensagemFinal);
    };

    return (
        <div
            className="gs-bloqueio-wrapper"
            style={style}
            onClick={handleClick}
            title={modoBloqueio === 'pagina' ? 'Acesso à página bloqueado' : 'Você não tem permissão para esta ação'}
        >
            {children}
            <div className="gs-bloqueio-overlay" aria-hidden="true">
                <i className="fas fa-lock gs-bloqueio-lock-icon"></i>
            </div>
        </div>
    );
}
