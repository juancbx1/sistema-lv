// public/src/pages/ConfigAlertas/ConfigAlertasPage.tsx

import { useState } from 'react';
import { mostrarMensagem } from '../../../js/utils/popups.js';
import UIHeaderPagina from '../../components/UIHeaderPagina';
import UITabNav from '../../components/UITabNav';
import ConfigAlertasGerais from '../../components/ConfigAlertasGerais';
import AvisosPopupAdmin from '../../components/AvisosPopupAdmin';
import AvisosPopupGaleria from '../../components/AvisosPopupGaleria';
import type { ConfigAlertasAba } from '../../utils/alertas-types';

export default function ConfigAlertasPage() {
    const [aba, setAba] = useState<ConfigAlertasAba>('alertas');
    const [modalNovoAvisoAberto, setModalNovoAvisoAberto] = useState(false);
    const [galeriaAberta, setGaleriaAberta] = useState(false);

    const handleTestarSom = () => {
        new Audio('/sounds/alerta.mp3').play().catch(() => {
            mostrarMensagem('Não foi possível reproduzir o som. Interaja com a página primeiro.', 'aviso');
        });
    };

    return (
        <>
            <UIHeaderPagina titulo="Central de Alertas">
                {aba === 'avisos' && (
                    <>
                        <button
                            className="gs-btn gs-btn-secundario"
                            onClick={() => setGaleriaAberta(true)}
                            title="Galeria de imagens"
                        >
                            <i className="fas fa-images"></i>
                        </button>
                        <button
                            className="gs-btn gs-btn-primario"
                            onClick={() => setModalNovoAvisoAberto(true)}
                        >
                            <i className="fas fa-plus"></i> Novo Aviso
                        </button>
                    </>
                )}
                {aba === 'alertas' && (
                    <button className="gs-btn gs-btn-secundario" onClick={handleTestarSom}>
                        <i className="fas fa-volume-up"></i>
                    </button>
                )}
            </UIHeaderPagina>

            <UITabNav
                ariaLabel="Áreas da central de alertas"
                activeId={aba}
                onChange={(id) => setAba(id as ConfigAlertasAba)}
                items={[
                    { id: 'alertas', label: 'Alertas Gerais', icon: 'fa-bell' },
                    { id: 'avisos', label: 'Avisos Popups', icon: 'fa-bullhorn' },
                ]}
            />

            <div className="gs-conteudo-pagina">
                {aba === 'alertas' && (
                    <ConfigAlertasGerais onTestarSom={handleTestarSom} />
                )}
                {aba === 'avisos' && (
                    <AvisosPopupAdmin
                        modalAberto={modalNovoAvisoAberto}
                        onFecharModal={() => setModalNovoAvisoAberto(false)}
                    />
                )}
            </div>

            {galeriaAberta && (
                <AvisosPopupGaleria onFechar={() => setGaleriaAberta(false)} />
            )}
        </>
    );
}
