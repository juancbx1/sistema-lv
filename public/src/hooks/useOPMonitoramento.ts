import { useEffect, useSyncExternalStore } from 'react';
import { buscarMonitoramentoOps } from '../utils/op-monitoramento-api';
import type { OPMonitoramentoStoreSnapshot } from '../utils/op-monitoramento-types';

const INTERVALO_MS = 60_000;
const listeners = new Set<() => void>();
let consumidores = 0;
let intervalo: number | null = null;
let buscando = false;
let snapshot: OPMonitoramentoStoreSnapshot = {
  dados: null,
  carregando: true,
  atualizando: false,
  erro: null,
};

function emitir() {
  listeners.forEach((listener) => listener());
  if (snapshot.dados) {
    window.dispatchEvent(new CustomEvent('lv:op-monitoramento-atualizado', {
      detail: snapshot.dados,
    }));
  }
}

function definir(proximo: Partial<OPMonitoramentoStoreSnapshot>) {
  snapshot = { ...snapshot, ...proximo };
  emitir();
}

export async function atualizarOPMonitoramento() {
  if (buscando) return;
  buscando = true;
  definir({
    carregando: snapshot.dados === null,
    atualizando: snapshot.dados !== null,
    erro: null,
  });
  try {
    const dados = await buscarMonitoramentoOps();
    definir({ dados, carregando: false, atualizando: false, erro: null });
  } catch (error) {
    definir({
      carregando: false,
      atualizando: false,
      erro: error instanceof Error ? error.message : 'Não foi possível atualizar o monitoramento.',
    });
  } finally {
    buscando = false;
  }
}

function aoVisibilidade() {
  if (document.visibilityState === 'visible') void atualizarOPMonitoramento();
}

function aoContextoAlterado() {
  snapshot = { dados: null, carregando: true, atualizando: false, erro: null };
  emitir();
  void atualizarOPMonitoramento();
}

function iniciar() {
  consumidores += 1;
  if (consumidores !== 1) return;
  void atualizarOPMonitoramento();
  intervalo = window.setInterval(() => {
    if (document.visibilityState === 'visible') void atualizarOPMonitoramento();
  }, INTERVALO_MS);
  document.addEventListener('visibilitychange', aoVisibilidade);
  window.addEventListener('focus', aoVisibilidade);
  window.addEventListener('op-encerrada', aoVisibilidade);
  window.addEventListener('lv:empresa-contexto-alterado', aoContextoAlterado);
  window.addEventListener('lv:empresa-contexto-carregado', aoContextoAlterado);
}

function parar() {
  consumidores = Math.max(0, consumidores - 1);
  if (consumidores !== 0) return;
  if (intervalo !== null) window.clearInterval(intervalo);
  intervalo = null;
  document.removeEventListener('visibilitychange', aoVisibilidade);
  window.removeEventListener('focus', aoVisibilidade);
  window.removeEventListener('op-encerrada', aoVisibilidade);
  window.removeEventListener('lv:empresa-contexto-alterado', aoContextoAlterado);
  window.removeEventListener('lv:empresa-contexto-carregado', aoContextoAlterado);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return snapshot;
}

export default function useOPMonitoramento(ativo = true) {
  const estado = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!ativo) return undefined;
    iniciar();
    return parar;
  }, [ativo]);
  return { ...estado, atualizar: atualizarOPMonitoramento };
}

