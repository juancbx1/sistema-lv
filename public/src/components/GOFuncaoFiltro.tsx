import React, { useEffect, useMemo, useRef, useState } from 'react';

export const GO_FUNCOES: Array<[string, string]> = [
    ['administrador', 'Administrador'],
    ['supervisor', 'Supervisor'],
    ['lider_setor', 'Líder de setor'],
    ['costureira', 'Costureira'],
    ['tiktik', 'TikTik'],
    ['cortador', 'Cortador'],
    ['socio', 'Sócio'],
    ['prestador_externo', 'Prestador externo'],
];

interface GOFuncaoFiltroProps {
    selecionadas: string[];
    onChange: (funcoes: string[]) => void;
}

export default function GOFuncaoFiltro({ selecionadas, onChange }: GOFuncaoFiltroProps) {
    const [aberto, setAberto] = useState(false);
    const [busca, setBusca] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!aberto) return undefined;
        const fecharFora = (event: MouseEvent) => {
            if (ref.current && !ref.current.contains(event.target as Node)) setAberto(false);
        };
        document.addEventListener('mousedown', fecharFora);
        return () => document.removeEventListener('mousedown', fecharFora);
    }, [aberto]);

    const opcoes = useMemo(() => {
        const termo = busca.trim().toLowerCase();
        return GO_FUNCOES.filter(([id, label]) => !termo || id.includes(termo) || label.toLowerCase().includes(termo));
    }, [busca]);

    const alternar = (id: string) => {
        onChange(selecionadas.includes(id)
            ? selecionadas.filter((item) => item !== id)
            : [...selecionadas, id]);
    };

    return (
        <div className="go-funcao-filtro" ref={ref}>
            <button
                type="button"
                className={`go-funcao-filtro-botao${selecionadas.length ? ' ativo' : ''}`}
                onClick={() => setAberto((atual) => !atual)}
                aria-expanded={aberto}
                aria-haspopup="dialog"
            >
                <i className="fas fa-sliders"></i>
                Funções
                {selecionadas.length > 0 && <span className="go-funcao-filtro-contador">{selecionadas.length}</span>}
                <i className={`fas fa-chevron-${aberto ? 'up' : 'down'} go-funcao-filtro-chevron`}></i>
            </button>
            {aberto && (
                <div className="go-funcao-filtro-painel" role="dialog" aria-label="Filtrar por função">
                    <div className="go-funcao-filtro-painel-cabecalho">
                        <div>
                            <strong>Filtrar por função</strong>
                            <small>Escolha uma ou mais funções</small>
                        </div>
                        <button type="button" className="go-funcao-filtro-fechar" onClick={() => setAberto(false)} aria-label="Fechar filtro">
                            <i className="fas fa-times"></i>
                        </button>
                    </div>
                    <label className="go-funcao-filtro-busca">
                        <i className="fas fa-search"></i>
                        <input value={busca} onChange={(event) => setBusca(event.target.value)} placeholder="Buscar função..." autoFocus />
                    </label>
                    <div className="go-funcao-filtro-lista">
                        {opcoes.map(([id, label]) => (
                            <label key={id} className={`go-funcao-opcao${selecionadas.includes(id) ? ' selecionada' : ''}`}>
                                <input type="checkbox" checked={selecionadas.includes(id)} onChange={() => alternar(id)} />
                                <span>{label}</span>
                                <i className="fas fa-check"></i>
                            </label>
                        ))}
                        {!opcoes.length && <span className="go-funcao-filtro-vazio">Nenhuma função corresponde à busca.</span>}
                    </div>
                    <div className="go-funcao-filtro-rodape">
                        <button type="button" onClick={() => { onChange([]); setBusca(''); }}>Limpar filtros</button>
                        <button type="button" className="go-funcao-filtro-concluir" onClick={() => setAberto(false)}>Concluir</button>
                    </div>
                </div>
            )}
        </div>
    );
}
