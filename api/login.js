// api/login.js
import 'dotenv/config';
import pkg from 'pg';
const { Pool } = pkg;
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import express from 'express';
import { carregarContextoEmpresa } from './contexto-empresa.js';

// 1. Cria um novo Roteador do Express
const router = express.Router();

// 2. Configura a conexão com o banco de dados
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
});

const SECRET_KEY = process.env.JWT_SECRET;

// 3. Define a rota POST para a raiz do roteador ('/')
//    Quando o api/index.js fizer app.use('/login', loginRouter),
//    esta rota responderá a POST /api/login
router.post('/', async (req, res) => {
  const { nomeUsuario, senha } = req.body;

  if (!nomeUsuario || !senha) {
    return res.status(400).json({ error: 'Nome de usuário e senha são obrigatórios.' });
  }

  let clienteDb;
  try {
    clienteDb = await pool.connect();
    const result = await clienteDb.query(
      `
        SELECT
          id,
          nome,
          nome_usuario,
          email,
          senha,
          tipos,
          permissoes,
          nivel,
          data_demissao,
          COALESCE(arquivado, FALSE) AS arquivado
        FROM usuarios
        WHERE nome_usuario = $1
      `,
      [nomeUsuario]
    );
    const usuario = result.rows[0];

    if (!usuario) {
      // Usar uma mensagem genérica em produção é mais seguro
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const senhaValida = await bcrypt.compare(senha, usuario.senha);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Verificar se o empregado foi demitido (apenas para usuários do tipo costureira/tiktik)
    // Admins não têm data_demissao, mas a verificação é segura para qualquer tipo
    if (usuario.data_demissao) {
      return res.status(403).json({
        error: 'CONTRATO_ENCERRADO',
        nome: usuario.nome,
      });
    }

    if (usuario.arquivado) {
      return res.status(403).json({
        error: 'CONTA_INATIVA',
        nome: usuario.nome,
      });
    }

    let contexto;
    try {
      contexto = await carregarContextoEmpresa(clienteDb, { id: usuario.id });
    } catch (error) {
      if (error.codigo === 'EMPRESA_NAO_AUTORIZADA') {
        const vinculoEncerrado = await clienteDb.query(
          `
            SELECT EXISTS (
              SELECT 1
              FROM usuarios_empresas
              WHERE usuario_id = $1
                AND data_demissao IS NOT NULL
            ) AS encerrado
          `,
          [usuario.id]
        );

        if (vinculoEncerrado.rows[0]?.encerrado) {
          return res.status(403).json({
            error: 'CONTRATO_ENCERRADO',
            nome: usuario.nome,
          });
        }

        return res.status(403).json({
          error: 'SEM_EMPRESA_ATIVA',
          nome: usuario.nome,
        });
      }
      throw error;
    }

    const payload = {
      id: usuario.id,
      nome_usuario: usuario.nome_usuario,
      nome: usuario.nome,
      tipos: contexto.vinculo?.tipos || [],
      empresa_id: contexto.empresa.id,
      vinculo_empresa_id: contexto.vinculo?.id || null,
      superadministrador: contexto.identidade.superadministrador,
    };

    // A sessao persistente de 30 dias e o comportamento padrao do sistema.
    // O campo legado "manterConectado" pode continuar sendo enviado por
    // clientes antigos, mas nao deve reduzir a validade para 8 horas.
    const expiresIn = '30d';

    const token = jwt.sign(
      payload,
      SECRET_KEY,
      { expiresIn }
    );

    // O frontend agora é responsável por pegar este token e fazer uma
    // chamada subsequente para /api/usuarios/me para obter os detalhes completos.
    res.status(200).json({
      token,
      empresaAtiva: {
        id: contexto.empresa.id,
        codigo: contexto.empresa.codigo,
        nome_fantasia: contexto.empresa.nome_fantasia,
        logo_url: contexto.empresa.logo_url,
        cor_identificacao: contexto.empresa.cor_identificacao,
      },
    });

  } catch (error) {
    console.error('[API /login] Erro durante o processo de login:', error);
    res.status(500).json({ error: 'Erro interno no servidor durante o login.' });
  } finally {
    if (clienteDb) {
      clienteDb.release();
    }
  }
});

// 4. Exporta o roteador para ser usado pelo api/index.js
export default router;
