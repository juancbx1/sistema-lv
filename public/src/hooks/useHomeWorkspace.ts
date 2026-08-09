import { useCallback, useEffect, useMemo, useState } from 'react';
import type { HomeFocoItem, HomeRecente, HomeWorkspace } from '../utils/home-types';

const MAX_FOCOS = 6;
const MAX_RECENTES = 6;

function dataLocal() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function chaveBase(usuarioId?: number, empresaId?: number) {
  return usuarioId && empresaId ? `home-workspace:${usuarioId}:${empresaId}` : null;
}

function lerListaLocal<T>(
  chave: string | null,
  validar: (valor: unknown) => valor is T,
  limite: number,
): T[] {
  if (!chave) return [];
  try {
    const salvo = localStorage.getItem(chave);
    if (!salvo) return [];
    const valor = JSON.parse(salvo) as unknown;
    return Array.isArray(valor) ? valor.filter(validar).slice(0, limite) : [];
  } catch {
    return [];
  }
}

function salvarListaLocal(chave: string | null, valor: unknown[]) {
  if (!chave) return;
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // O estado em memória continua funcional quando o armazenamento local
    // estiver indisponível, cheio ou bloqueado pelo navegador.
  }
}

function ehFocoItem(valor: unknown): valor is HomeFocoItem {
  if (!valor || typeof valor !== 'object') return false;
  const item = valor as Partial<HomeFocoItem>;
  return typeof item.id === 'string'
    && typeof item.texto === 'string'
    && typeof item.concluido === 'boolean'
    && typeof item.criadoEm === 'string';
}

function ehRecente(valor: unknown): valor is HomeRecente {
  if (!valor || typeof valor !== 'object') return false;
  const item = valor as Partial<HomeRecente>;
  return typeof item.itemId === 'string' && typeof item.acessadoEm === 'string';
}

function criarId() {
  return typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function useHomeWorkspace(usuarioId?: number, empresaId?: number) {
  const [diaAtual, setDiaAtual] = useState(dataLocal);
  const chave = useMemo(() => chaveBase(usuarioId, empresaId), [empresaId, usuarioId]);
  const chaveFocos = chave ? `${chave}:foco:${diaAtual}` : null;
  const chaveRecentes = chave ? `${chave}:recentes` : null;
  const [workspace, setWorkspace] = useState<HomeWorkspace>({ focos: [], recentes: [] });

  useEffect(() => {
    const agora = new Date();
    const proximoDia = new Date(
      agora.getFullYear(),
      agora.getMonth(),
      agora.getDate() + 1,
      0,
      0,
      1,
    );
    const timer = window.setTimeout(() => setDiaAtual(dataLocal()), proximoDia.getTime() - agora.getTime());
    return () => window.clearTimeout(timer);
  }, [diaAtual]);

  useEffect(() => {
    setWorkspace({
      focos: lerListaLocal(chaveFocos, ehFocoItem, MAX_FOCOS),
      recentes: lerListaLocal(chaveRecentes, ehRecente, MAX_RECENTES),
    });
  }, [chaveFocos, chaveRecentes]);

  const persistirFocos = useCallback((focos: HomeFocoItem[]) => {
    setWorkspace((atual) => ({ ...atual, focos }));
    salvarListaLocal(chaveFocos, focos);
  }, [chaveFocos]);

  const adicionarFoco = useCallback((texto: string) => {
    const normalizado = texto.trim().replace(/\s+/g, ' ');
    if (!normalizado || workspace.focos.length >= MAX_FOCOS) return false;
    persistirFocos([
      ...workspace.focos,
      {
        id: criarId(),
        texto: normalizado.slice(0, 90),
        concluido: false,
        criadoEm: new Date().toISOString(),
      },
    ]);
    return true;
  }, [persistirFocos, workspace.focos]);

  const alternarFoco = useCallback((id: string) => {
    persistirFocos(workspace.focos.map((foco) =>
      foco.id === id ? { ...foco, concluido: !foco.concluido } : foco,
    ));
  }, [persistirFocos, workspace.focos]);

  const removerFoco = useCallback((id: string) => {
    persistirFocos(workspace.focos.filter((foco) => foco.id !== id));
  }, [persistirFocos, workspace.focos]);

  const registrarAcesso = useCallback((itemId: string) => {
    const proximos = [
      { itemId, acessadoEm: new Date().toISOString() },
      ...workspace.recentes.filter((item) => item.itemId !== itemId),
    ].slice(0, MAX_RECENTES);
    setWorkspace((atual) => ({ ...atual, recentes: proximos }));
    salvarListaLocal(chaveRecentes, proximos);
  }, [chaveRecentes, workspace.recentes]);

  return {
    ...workspace,
    maxFocos: MAX_FOCOS,
    adicionarFoco,
    alternarFoco,
    removerFoco,
    registrarAcesso,
  };
}
