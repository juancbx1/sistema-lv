// api/upload.js
import { put } from '@vercel/blob';
import express from 'express';
import jwt from 'jsonwebtoken';
import { obterEmpresaIdDoContexto } from './contexto-empresa.js';
import { getPermissoesCompletasUsuarioDB } from './usuarios.js';

const router = express.Router();
const SECRET_KEY = process.env.JWT_SECRET;

// Função para converter o stream da requisição em um buffer
async function streamToBuffer(readableStream) {
    const chunks = [];
    for await (const chunk of readableStream) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

router.post('/', async (req, res) => {
    let usuarioLogado;
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Token de autenticação ausente.' });
        }
        const token = authHeader.split(' ')[1];
        usuarioLogado = jwt.verify(token, SECRET_KEY); // Agora guardamos os dados do usuário
    } catch (error) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }

    try {
        const empresaId = obterEmpresaIdDoContexto(req);
        const permissoes = await getPermissoesCompletasUsuarioDB(null, usuarioLogado.id, empresaId);
        if (!permissoes.includes('gerenciar-produtos')) {
            return res.status(403).json({ error: 'Permissão negada para enviar imagens de produtos.' });
        }
    } catch (error) {
        console.error('ERRO AO VALIDAR PERMISSÃO DE UPLOAD:', error.message);
        return res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao validar permissão de upload.' });
    }

    const filename = req.headers['x-filename'];
    if (!filename) {
        return res.status(400).json({ error: 'O header "x-filename" é obrigatório.' });
    }

    try {
        const fileBuffer = await streamToBuffer(req);

        // --- INÍCIO DAS MUDANÇAS ---

        // 1. Criamos um nome de arquivo único para o Blob
        // Ex: avatares/usuario-123-minhafoto.jpg
        const blobPathname = `avatares/usuario-${usuarioLogado.id}-${filename}`;

        const blob = await put(blobPathname, fileBuffer, {
            access: 'public',
            // 2. Adicionamos a opção para evitar conflitos de nome
            addRandomSuffix: true, 
            token: process.env.BLOB_READ_WRITE_TOKEN,
        });

        // --- FIM DAS MUDANÇAS ---

        return res.status(200).json(blob);

    } catch (error) {
        console.error("ERRO NA API DE UPLOAD:", error.message);
        return res.status(500).json({ error: `Falha no upload do arquivo: ${error.message}` });
    }
});

export default router;
