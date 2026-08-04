# Plano — Saldo do cartão VT

Documento de execução da feature. Detalhe completo também em sessão/plan.

## Decisões fechadas

| Tema | Valor |
|---|---|
| Unidade | 2 vias/dia (ida + volta) |
| Valor por via | `valor_passagem_diaria / 2` |
| Corte | 18h America/Sao_Paulo — os 2 débitos juntos |
| Provisionamento | 48h até validar crédito |
| Falta calendário | `falta_justificada` / `falta_injustificada` (migra `falta` → injustificada) |
| Falta → VT | não debita; registra transferência para próximo dia útil |
| Carona / uso parcial | só ida, só volta, nenhuma ou as duas |
| Ajuste retroativo | sim, aba Passagem; teto 60 dias |
| Justificativas | **sempre** fato; demora se ajuste após o dia do fato |
| UI carona/ajuste | **somente** Central de Pagamentos → Passagem |
| Permissão | `ajustar-consumo-vt` |

## Arquivos principais

- `_planejamento/migration-vt-cartao-saldo.sql`
- `api/vt-cartao-motor.js`
- rotas em `api/pagamentos.js` e `api/dashboard.js`
- UI: `CPAGVtSaldoPainel`, `CPAGVtAjusteConsumoModal`, `DashVtSaldoCard`

## Migration

Não executar em Neon sem autorização. Ensaio local primeiro.
