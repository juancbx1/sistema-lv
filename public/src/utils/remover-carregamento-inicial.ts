/** Remove o loader estático que protege a primeira pintura antes do bundle React. */
export default function removerCarregamentoInicial(): void {
    document.getElementById('lv-initial-page-loader')?.remove();
}
