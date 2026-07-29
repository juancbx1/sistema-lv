import fs from 'node:fs';
import path from 'node:path';

const arquivo = path.resolve(process.argv[2] || 'api/financeiro.js');
const fonte = fs.readFileSync(arquivo, 'utf8');
const tabelas = [
    'fc_contas_bancarias',
    'fc_grupos_financeiros',
    'fc_categorias',
    'fc_contatos',
    'fc_lancamentos',
    'fc_lancamento_itens',
    'fc_contas_agendadas',
    'fc_contas_agendadas_itens',
    'fc_lotes_agendamento',
    'fc_solicitacoes_alteracao',
    'fc_logs_auditoria',
    'fc_notificacoes',
    'config_concessionarias_vt',
];

const padraoTabela = new RegExp(`\\b(${tabelas.join('|')})\\b`, 'i');
const padraoSql = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
const padraoString = /`[\s\S]*?`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
const ocorrencias = [];
const dinamicas = [];

for (const match of fonte.matchAll(padraoString)) {
    const texto = match[0];
    if (!padraoSql.test(texto) || !padraoTabela.test(texto)) continue;
    if (/\bempresa_id\b/i.test(texto)) continue;

    const inicio = match.index || 0;
    const linha = fonte.slice(0, inicio).split(/\r?\n/).length;
    const ocorrencia = {
        linha,
        trecho: texto.replace(/\s+/g, ' ').slice(0, 240),
    };
    if (texto.includes('${whereSql}') || texto.includes('${whereString}')) {
        dinamicas.push(ocorrencia);
    } else {
        ocorrencias.push(ocorrencia);
    }
}

process.stdout.write(JSON.stringify({
    arquivo,
    aprovado: ocorrencias.length === 0,
    total_suspeitas: ocorrencias.length,
    suspeitas: ocorrencias,
    total_dinamicas_para_revisao: dinamicas.length,
    dinamicas_para_revisao: dinamicas,
}, null, 2));

if (ocorrencias.length > 0) {
    process.exitCode = 1;
}
