// public/src/components/UIBloqueio.jsx
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
//       import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';
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

import React, { useMemo } from 'react';
import { temPermissao, mostrarPopupSemPermissao } from '../utils/bloqueio.js';

/**
 * @param {string}      permissao  - ID da permissão necessária
 * @param {string}      [mensagem] - Mensagem customizada no popup (opcional)
 * @param {object}      [style]    - Estilos inline para o wrapper (ex: {{ flex: 1 }} quando o botão é flex item com flex:1)
 * @param {ReactNode}   children   - Elemento(s) filho(s) a envolver
 */
export default function UIBloqueio({ permissao, mensagem, style, children }) {
    const bloqueado = useMemo(() => !temPermissao(permissao), [permissao]);

    // Com permissão: renderiza os filhos sem nenhuma alteração
    if (!bloqueado) return children;

    const handleClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        mostrarPopupSemPermissao(mensagem);
    };

    return (
        <div
            className="gs-bloqueio-wrapper"
            style={style}
            onClick={handleClick}
            title="Você não tem permissão para esta ação"
        >
            {children}
            <div className="gs-bloqueio-overlay" aria-hidden="true">
                <i className="fas fa-lock gs-bloqueio-lock-icon"></i>
            </div>
        </div>
    );
}
