import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
    process.argv[2] || '_planejamento/migration-multiempresas-fase7-preparacao.sql'
);
const validacaoPath = path.resolve(
    process.argv[3] || '_planejamento/validacao-multiempresas-fase7-preparacao.sql'
);
const migration = fs.readFileSync(migrationPath, 'utf8');
const validacao = fs.readFileSync(validacaoPath, 'utf8');

const tabelas = [
    'ponto_diario',
    'sessoes_trabalho_producao',
    'historico_pagamentos_funcionarios',
    'registro_dias_trabalhados',
    'recibos_conferencia',
    'banco_pontos_saldo',
    'banco_pontos_log',
    'pontos_extras',
    'configuracoes_pontos_processos',
    'metas_versoes',
    'metas_regras',
    'gincanas',
    'gincanas_premiacoes',
    'gincanas_premios_ganhos',
    'avisos_popup',
    'avisos_popup_visualizacoes',
    'calendario_empresa',
];

const constraints = Array.from(
    migration.matchAll(/\bADD\s+CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi),
    (match) => match[1]
);
const duplicadas = constraints.filter(
    (constraint, index) => constraints.indexOf(constraint) !== index
);
const longas = constraints.filter((constraint) => constraint.length > 63);
const constraintsAusentesNoValidador = constraints.filter(
    (constraint) => !validacao.includes(`'${constraint}'`)
);
const tabelasSemColuna = tabelas.filter(
    (tabela) =>
        !new RegExp(
            `ALTER\\s+TABLE\\s+${tabela}\\s+ADD\\s+COLUMN\\s+IF\\s+NOT\\s+EXISTS\\s+empresa_id`,
            'i'
        ).test(migration)
);
const tabelasSemBackfill = tabelas.filter(
    (tabela) => !new RegExp(`UPDATE\\s+${tabela}\\b`, 'i').test(migration)
);
const fksNaoValidadas = (
    migration.match(/\bFOREIGN\s+KEY\b[\s\S]*?\bNOT\s+VALID\b/gi) || []
).length;
const colunasEmpresa = (
    migration.match(/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+empresa_id\b/gi) || []
).length;

const aprovado =
    colunasEmpresa === tabelas.length
    && tabelasSemColuna.length === 0
    && tabelasSemBackfill.length === 0
    && constraints.length === 56
    && fksNaoValidadas === 34
    && duplicadas.length === 0
    && longas.length === 0
    && constraintsAusentesNoValidador.length === 0
    && /\bBEGIN\s*;/i.test(migration)
    && /\bCOMMIT\s*;/i.test(migration)
    && /\bBEGIN\s+READ\s+ONLY\s*;/i.test(validacao)
    && /\bROLLBACK\s*;/i.test(validacao);

process.stdout.write(JSON.stringify({
    aprovado,
    tabelas_esperadas: tabelas.length,
    colunas_empresa_id: colunasEmpresa,
    constraints: constraints.length,
    fks_nao_validadas: fksNaoValidadas,
    tabelas_sem_coluna: tabelasSemColuna,
    tabelas_sem_backfill: tabelasSemBackfill,
    constraints_duplicadas: [...new Set(duplicadas)],
    constraints_longas: longas,
    constraints_ausentes_no_validador: constraintsAusentesNoValidador,
}, null, 2));

if (!aprovado) {
    process.exitCode = 1;
}
