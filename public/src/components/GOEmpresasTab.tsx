import React, { useMemo, useState } from 'react';
import UICarregando from './UICarregando';
import UIBloqueio from './UIBloqueio';
import GOEmpresaCard from './GOEmpresaCard';
import type { GOEmpresa } from '../utils/go-types';

interface GOEmpresasTabProps {
    empresas: GOEmpresa[];
    empresaAtivaId: number | null;
    carregando: boolean;
    onNova: () => void;
    onEditar: (empresa: GOEmpresa) => void;
    onVerPessoas: (empresa: GOEmpresa) => void;
}

export default function GOEmpresasTab({ empresas, empresaAtivaId, carregando, onNova, onEditar, onVerPessoas }: GOEmpresasTabProps) {
    const [busca, setBusca] = useState('');
    const [mostrarInativas, setMostrarInativas] = useState(false);
    const filtradas = useMemo(() => {
        const termo = busca.toLowerCase().trim();
        return empresas.filter((empresa) =>
            (mostrarInativas || empresa.ativa)
            && (!termo || [empresa.nome_fantasia, empresa.razao_social, empresa.codigo, empresa.cnpj]
                .some((valor) => String(valor || '').toLowerCase().includes(termo))));
    }, [empresas, busca, mostrarInativas]);

    return (
        <>
            <section className="go-toolbar gs-card gs-card--compacto">
                <div className="go-toolbar-busca">
                    <i className="fas fa-search"></i>
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar empresa" />
                </div>
                <label className="go-toggle-inativas"><input type="checkbox" checked={mostrarInativas} onChange={(e) => setMostrarInativas(e.target.checked)} /> Mostrar inativas</label>
                <UIBloqueio permissao="gerenciar-empresas">
                    <button className="gs-btn gs-btn-primario" onClick={onNova}><i className="fas fa-building-circle-check"></i> Nova empresa</button>
                </UIBloqueio>
            </section>
            {carregando ? <UICarregando variante="bloco" /> : (
                <section className="go-secao">
                    <div className="go-secao-cabecalho"><div><span className="go-eyebrow">Estrutura empresarial</span><h2>Empresas cadastradas <small>{filtradas.length}</small></h2></div></div>
                    {filtradas.length ? (
                        <div className="go-empresas-grid">
                            {filtradas.map((empresa) => <GOEmpresaCard key={empresa.id} empresa={empresa} empresaAtivaId={empresaAtivaId} onEditar={onEditar} onVerPessoas={onVerPessoas} />)}
                        </div>
                    ) : <div className="go-vazio"><i className="fas fa-building"></i><p>Nenhuma empresa encontrada.</p></div>}
                </section>
            )}
        </>
    );
}
