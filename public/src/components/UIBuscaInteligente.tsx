// public/src/components/UIBuscaInteligente.tsx

import { useState, useEffect, useRef, type KeyboardEvent, type MouseEvent } from 'react';

/** Normaliza texto (remove acentos e lowercase). */
export const normalizarTexto = (texto: unknown): string => {
    if (texto == null || texto === '') return '';
    return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
};

/**
 * Filtragem inteligente (fuzzy / "per pret").
 * Exportada para que componentes pai usem na filtragem local.
 */
export const filtrarListaInteligente = <T extends Record<string, unknown>>(
    lista: T[],
    termoBusca: string,
    campos: Array<keyof T & string>,
): T[] => {
    if (!termoBusca) return lista;

    const termoLimpo = normalizarTexto(termoBusca);
    const partesTermo = termoLimpo.split(' ').filter((p) => p.length > 0);

    return lista.filter((item) => {
        return partesTermo.every((parte) => {
            return campos.some((campo) => {
                const valorCampo = normalizarTexto(item[campo]);
                return valorCampo.includes(parte);
            });
        });
    });
};

interface UIBuscaInteligenteProps {
    /** Função chamada ao buscar (recebe o valor digitado). */
    onSearch?: (termo: string) => void;
    placeholder?: string;
    /** Chave para salvar no localStorage (se null, não usa histórico). */
    historicoKey?: string | null;
    /** Debounce em ms. */
    delay?: number;
    initialValue?: string;
}

export default function UIBuscaInteligente({
    onSearch,
    placeholder = 'Buscar...',
    historicoKey = null,
    delay = 300,
    initialValue = '',
}: UIBuscaInteligenteProps) {
    const [termo, setTermo] = useState(initialValue);
    const [focado, setFocado] = useState(false);
    const [historico, setHistorico] = useState<string[]>([]);

    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Debounce da busca (COM CORREÇÃO DE PISCADA)
    const isFirstRun = useRef(true);

    useEffect(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        // Bloqueia a execução se for a primeira vez
        if (isFirstRun.current) {
            isFirstRun.current = false;
            return;
        }

        timeoutRef.current = setTimeout(() => {
            if (onSearch) onSearch(termo);
        }, delay);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [termo, delay, onSearch]);

    // Carregar histórico ao montar
    useEffect(() => {
        if (historicoKey) {
            const salvo = localStorage.getItem(`historico_busca_${historicoKey}`);
            if (salvo) {
                try {
                    const parsed = JSON.parse(salvo) as unknown;
                    if (Array.isArray(parsed)) {
                        setHistorico(parsed.filter((item): item is string => typeof item === 'string'));
                    }
                } catch {
                    // Histórico corrompido: ignora.
                }
            }
        }
    }, [historicoKey]);

    const adicionarAoHistorico = (novoTermo: string) => {
        if (!historicoKey || !novoTermo || novoTermo.trim().length < 2) return;

        const novoHistorico = [
            novoTermo,
            ...historico.filter((h) => h !== novoTermo),
        ].slice(0, 5);

        setHistorico(novoHistorico);
        localStorage.setItem(`historico_busca_${historicoKey}`, JSON.stringify(novoHistorico));
    };

    const removerDoHistorico = (e: MouseEvent, itemRemover: string) => {
        e.stopPropagation();
        const novoHistorico = historico.filter((h) => h !== itemRemover);
        setHistorico(novoHistorico);
        if (historicoKey) {
            localStorage.setItem(`historico_busca_${historicoKey}`, JSON.stringify(novoHistorico));
        }
    };

    // Debounce da busca (comportamento legado preservado: segundo effect)
    useEffect(() => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);

        timeoutRef.current = setTimeout(() => {
            if (onSearch) onSearch(termo);
        }, delay);

        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [termo, delay, onSearch]);

    // Fecha o histórico se clicar fora
    useEffect(() => {
        const handleClickOutside = (event: globalThis.MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setFocado(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelecionarRecente = (valor: string) => {
        setTermo(valor);
        setFocado(false);
        if (onSearch) onSearch(valor);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            adicionarAoHistorico(termo);
            setFocado(false);
        }
    };

    return (
        <div className="gs-filtro-busca-wrapper" ref={containerRef} style={{ position: 'relative', width: '100%' }}>
            <i className="fas fa-search" style={{
                position: 'absolute', left: '15px', top: '50%', transform: 'translateY(-50%)',
                color: '#aaa', pointerEvents: 'none',
            }}></i>

            <input
                type="text"
                className="op-input-busca-redesenhado"
                style={{ width: '100%', paddingLeft: '40px', paddingRight: termo ? '36px' : '12px' }}
                placeholder={placeholder}
                value={termo}
                onChange={(e) => setTermo(e.target.value)}
                onFocus={() => setFocado(true)}
                onKeyDown={handleKeyDown}
            />

            {termo && (
                <button
                    type="button"
                    className="gs-filtro-busca-limpar"
                    onClick={() => { setTermo(''); if (onSearch) onSearch(''); }}
                    title="Limpar busca"
                >
                    <i className="fas fa-times"></i>
                </button>
            )}

            {focado && historico.length > 0 && (
                <div className="gs-buscas-recentes-container">
                    <h4 className="gs-buscas-recentes-titulo">BUSCAS RECENTES</h4>
                    <div className="gs-buscas-recentes-lista">
                        {historico.map((h) => (
                            <div key={h} className="gs-pilula-recente" onClick={() => handleSelecionarRecente(h)}>
                                <span>{h}</span>
                                <span className="remover" onClick={(e) => removerDoHistorico(e, h)}>&times;</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
