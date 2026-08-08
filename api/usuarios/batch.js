import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import jwt from 'jsonwebtoken';
import {
  expandirAliasesPermissoes,
  permissoesValidas,
} from '../../public/js/utils/permissoes.js';

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;

const verificarToken = (req) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) throw new Error('Token não fornecido');
  return jwt.verify(token, SECRET_KEY);
};

export default async (req, res) => {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  try {
    const usuarioLogado = verificarToken(req);
    if (!usuarioLogado.permissoes.includes('gerenciar-permissoes')) {
      return res.status(403).json({ error: 'Permissão negada' });
    }

    const usuarios = req.body; // Espera um array de { id, permissoes }
    if (!Array.isArray(usuarios) || usuarios.length === 0) {
      return res.status(400).json({ error: 'Corpo da requisição inválido: esperado um array de usuários' });
    }

    // Usar uma transação para garantir consistência
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const usuario of usuarios) {
        const { id, permissoes } = usuario;
        if (!id || !Array.isArray(permissoes)) {
          throw new Error('Formato inválido: id ou permissoes ausentes/inválidos');
        }
        const permissoesValidasParaSalvar = expandirAliasesPermissoes(
          [...new Set(permissoes.filter((permissao) => permissoesValidas.has(permissao)))]
        );
        await client.query(
          'UPDATE usuarios SET permissoes = $1 WHERE id = $2',
          [permissoesValidasParaSalvar, id]
        );
      }
      await client.query('COMMIT');
      res.status(200).json({ message: 'Permissões atualizadas com sucesso' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[usuarios/batch] Erro ao atualizar permissões:', error);
      res.status(500).json({ error: 'Erro ao salvar permissões' });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('[usuarios/batch] Erro:', error);
    res.status(401).json({ error: 'Autenticação falhou ou erro no servidor' });
  }
};
