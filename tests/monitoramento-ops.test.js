import assert from 'node:assert/strict';
import test from 'node:test';

import { finalizarOrdemProducao } from '../api/utils/finalizar-op.js';
import {
  classificarFaixaMonitoramentoOps,
  consultarMonitoramentoOps,
  MONITORAMENTO_OPS_LIMITES_HORAS,
  usuarioPodeAcessarMonitoramento,
  usuarioPodeOperarMonitoramento,
} from '../api/utils/monitoramento-ops.js';

test('as faixas mudam exatamente nos limites aprovados', () => {
  assert.deepEqual(MONITORAMENTO_OPS_LIMITES_HORAS, {
    atencao: 3,
    obrigatoria: 8,
    critica: 24,
  });
  assert.equal(classificarFaixaMonitoramentoOps(2.99), 'ACOMPANHAMENTO');
  assert.equal(classificarFaixaMonitoramentoOps(3), 'ATENCAO');
  assert.equal(classificarFaixaMonitoramentoOps(7.99), 'ATENCAO');
  assert.equal(classificarFaixaMonitoramentoOps(8), 'OBRIGATORIA');
  assert.equal(classificarFaixaMonitoramentoOps(23.99), 'OBRIGATORIA');
  assert.equal(classificarFaixaMonitoramentoOps(24), 'CRITICA');
});

test('permissões legadas não revelam a Central v2', () => {
  const legadas = ['usar-agente-encerrador', 'usar-agente-central-ops', 'finalizar-op'];
  assert.equal(usuarioPodeAcessarMonitoramento(legadas), false);
  assert.equal(usuarioPodeOperarMonitoramento(legadas), false);
});

test('consulta e operação possuem autoridades separadas', () => {
  const consulta = ['acesso-monitoramento-ops'];
  const operacao = ['acesso-monitoramento-ops', 'finalizar-op'];
  assert.equal(usuarioPodeAcessarMonitoramento(consulta), true);
  assert.equal(usuarioPodeOperarMonitoramento(consulta), false);
  assert.equal(usuarioPodeOperarMonitoramento(operacao), true);
});

function criarDbMonitoramento({ ops, impedimentos = [], adiamentos = [] }) {
  return {
    async query(sql) {
      if (sql.includes('CURRENT_TIMESTAMP AS servidor_em')) {
        return { rows: [{ servidor_em: '2026-08-12T12:00:00.000Z' }] };
      }
      if (sql.includes('WITH etapas_op AS')) return { rows: ops };
      if (sql.includes('FROM op_monitoramento_impedimentos imp')) return { rows: impedimentos };
      if (sql.includes('FROM op_monitoramento_adiamentos')) return { rows: adiamentos };
      throw new Error(`Consulta inesperada no teste: ${sql}`);
    },
  };
}

const opBase = {
  edit_id: 'edit-1',
  numero: 101,
  produto_id: 7,
  variante: 'Azul',
  quantidade: 20,
  status: 'produzindo',
  etapas: [],
  produto_nome: 'Produto teste',
  produto_imagem: null,
  etapa_final_index: 1,
  total_etapas_op: 2,
  quantidade_feita_ultima_etapa: 18,
};

test('fila canônica aplica bloqueio e aceita impedimento mais recente que a produção', async () => {
  const db = criarDbMonitoramento({
    ops: [
      {
        ...opBase,
        id: 1,
        elegivel_desde: '2026-08-12T03:00:00.000Z',
        ultima_producao_em: '2026-08-12T03:00:00.000Z',
      },
      {
        ...opBase,
        id: 2,
        edit_id: 'edit-2',
        numero: 102,
        elegivel_desde: '2026-08-11T11:00:00.000Z',
        ultima_producao_em: '2026-08-12T10:00:00.000Z',
      },
    ],
    impedimentos: [{
      id: 50,
      op_id: 2,
      motivo: 'Aguardando conferência do lote físico.',
      registrado_em: '2026-08-12T11:00:00.000Z',
      atualizado_em: '2026-08-12T11:00:00.000Z',
      registrado_por: 9,
      registrado_por_nome: 'Supervisora',
    }],
  });

  const resultado = await consultarMonitoramentoOps(db, {
    empresaId: 1,
    usuarioId: 9,
    podeFinalizar: true,
    estrutura: { impedimentos: true, adiamentos: true, lotes: true, completa: true },
  });

  assert.equal(resultado.intercepcao_obrigatoria, true);
  assert.equal(resultado.pode_adiar, true);
  assert.equal(resultado.resumo.obrigatorias, 1);
  assert.equal(resultado.resumo.criticas, 1);
  assert.equal(resultado.resumo.impedidas, 1);
  assert.equal(resultado.resumo.pendentes_acao, 1);
});

test('sem as tabelas da migration o modo obrigatório falha fechado', async () => {
  const db = criarDbMonitoramento({
    ops: [{
      ...opBase,
      id: 3,
      elegivel_desde: '2026-08-12T03:00:00.000Z',
      ultima_producao_em: '2026-08-12T03:00:00.000Z',
    }],
  });
  const resultado = await consultarMonitoramentoOps(db, {
    empresaId: 1,
    usuarioId: 9,
    podeFinalizar: true,
    estrutura: { impedimentos: false, adiamentos: false, lotes: false, completa: false },
  });

  assert.equal(resultado.persistencia_disponivel, false);
  assert.equal(resultado.intercepcao_obrigatoria, false);
  assert.equal(resultado.pode_adiar, false);
});

test('finalização individual usa edit_id quando opId não foi informado', async () => {
  let primeiraConsulta;
  const db = {
    async query(sql, params) {
      primeiraConsulta = { sql, params };
      return { rows: [] };
    },
  };

  await assert.rejects(
    finalizarOrdemProducao(db, {
      empresaId: 2,
      usuarioLogado: { id: 11 },
      editId: 'op-edit-99',
    }),
    (error) => error.codigo === 'OP_NAO_ENCONTRADA',
  );
  assert.match(primeiraConsulta.sql, /op\.edit_id = \$1/);
  assert.deepEqual(primeiraConsulta.params, ['op-edit-99', 2]);
});
