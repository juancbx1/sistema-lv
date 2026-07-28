import { useMemo, useState } from 'react';

interface CPAGMultiDatePickerProps {
  diasSelecionados: string[];
  onToggleDia: (data: string) => void;
  readOnly?: boolean;
  diasBloqueados?: string[];
  legendaBloqueado?: string;
  legendaSelecionado?: string;
}

interface DiaGrade { data: Date; outroMes: boolean; }

const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const nomesDias = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

function dataLocalISO(data: Date): string {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

function gerarGrade(dataBase: Date): DiaGrade[] {
  const ano = dataBase.getFullYear();
  const mes = dataBase.getMonth();
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);
  const dias: DiaGrade[] = [];

  for (let i = primeiroDia.getDay() - 1; i >= 0; i -= 1) {
    dias.push({ data: new Date(ano, mes - 1, new Date(ano, mes, 0).getDate() - i), outroMes: true });
  }
  for (let dia = 1; dia <= ultimoDia.getDate(); dia += 1) {
    dias.push({ data: new Date(ano, mes, dia), outroMes: false });
  }
  for (let dia = 1; dias.length < 42; dia += 1) {
    dias.push({ data: new Date(ano, mes + 1, dia), outroMes: true });
  }
  return dias;
}

export default function CPAGMultiDatePicker({
  diasSelecionados,
  onToggleDia,
  readOnly = false,
  diasBloqueados = [],
  legendaBloqueado = 'Já Pago',
  legendaSelecionado = 'Selecionado',
}: CPAGMultiDatePickerProps) {
  const [dataBase, setDataBase] = useState(() => new Date());
  const grade = useMemo(() => gerarGrade(dataBase), [dataBase]);
  const ano = dataBase.getFullYear();
  const mes = dataBase.getMonth();

  const mudarMes = (offset: number) => setDataBase(new Date(ano, mes + offset, 1));

  return (
    <div className="cpg-datepicker-container" style={{ border: '1px solid #ddd', borderRadius: '8px', padding: '10px', background: '#fff', width: '100%', maxWidth: '320px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
        <button type="button" onClick={() => mudarMes(-1)} className="cpg-btn-icon-small" aria-label="Mês anterior">&lt;</button>
        <span style={{ fontWeight: 'bold' }}>{meses[mes]} {ano}</span>
        <button type="button" onClick={() => mudarMes(1)} className="cpg-btn-icon-small" aria-label="Próximo mês">&gt;</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', textAlign: 'center', marginBottom: '5px', fontSize: '0.8rem', color: '#666' }}>
        {nomesDias.map((dia, index) => <div key={`${dia}-${index}`}>{dia}</div>)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
        {grade.map(({ data, outroMes }) => {
          const dataStr = dataLocalISO(data);
          const selecionado = diasSelecionados.includes(dataStr);
          const bloqueado = diasBloqueados.includes(dataStr);
          return (
            <button
              type="button"
              key={dataStr}
              onClick={() => !readOnly && onToggleDia(dataStr)}
              aria-pressed={selecionado}
              style={{
                padding: '8px 0', textAlign: 'center', borderRadius: '4px',
                backgroundColor: selecionado ? 'var(--cpg-cor-primaria)' : bloqueado ? '#e0e0e0' : 'transparent',
                color: selecionado ? '#fff' : outroMes ? '#ccc' : bloqueado ? '#999' : '#333',
                border: bloqueado && !selecionado ? '1px solid #ccc' : 'none',
                cursor: readOnly ? 'default' : 'pointer', fontWeight: selecionado ? 'bold' : 'normal',
                fontSize: '0.9rem', opacity: outroMes && !selecionado ? 0.6 : 1,
              }}
            >{data.getDate()}</button>
          );
        })}
      </div>
      <div style={{ marginTop: '10px', display: 'flex', gap: '10px', justifyContent: 'center', fontSize: '0.75rem', borderTop: '1px solid #eee', paddingTop: '10px' }}>
        <span><i className="fas fa-circle" style={{ color: 'var(--cpg-cor-primaria)' }} /> {legendaSelecionado}</span>
        <span><i className="fas fa-circle" style={{ color: '#e0e0e0' }} /> {legendaBloqueado}</span>
      </div>
    </div>
  );
}
