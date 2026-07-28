import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

export interface AutocompleteItem { id: string | number; nome: string; tipo?: string; [key: string]: unknown; }
interface Props { apiEndpoint: string; placeholder?: string; onSelectionChange: (item: AutocompleteItem | null) => void; initialSelection?: AutocompleteItem | null; }

function useDebounce<T>(value: T, delay: number) { const [debouncedValue, setDebouncedValue] = useState(value); useEffect(() => { const handler = window.setTimeout(() => setDebouncedValue(value), delay); return () => window.clearTimeout(handler); }, [value, delay]); return debouncedValue; }

export default function UIAutocompleteAPI({ apiEndpoint, placeholder, onSelectionChange, initialSelection }: Props) {
  const [searchTerm, setSearchTerm] = useState(initialSelection?.nome || '');
  const [selectedItem, setSelectedItem] = useState<AutocompleteItem | null>(initialSelection || null);
  const [results, setResults] = useState<AutocompleteItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const debouncedSearchTerm = useDebounce(searchTerm, 400);

  useEffect(() => { setSelectedItem(initialSelection || null); setSearchTerm(initialSelection?.nome || ''); }, [initialSelection]);
  useEffect(() => {
    if (debouncedSearchTerm.length < 2 || (selectedItem && debouncedSearchTerm === selectedItem.nome)) { setResults([]); setIsOpen(false); return; }
    const controller = new AbortController();
    const fetchData = async () => { setIsLoading(true); try { const token = localStorage.getItem('token'); const response = await fetch(`${apiEndpoint}?q=${encodeURIComponent(debouncedSearchTerm)}`, { headers: { Authorization: `Bearer ${token ?? ''}` }, signal: controller.signal }); if (!response.ok) throw new Error('Falha na busca'); setResults(await response.json() as AutocompleteItem[]); setIsOpen(true); } catch (error) { if ((error as Error).name !== 'AbortError') { console.error('Erro na busca do autocomplete:', error); setResults([]); } } finally { if (!controller.signal.aborted) setIsLoading(false); } };
    void fetchData(); return () => controller.abort();
  }, [debouncedSearchTerm, apiEndpoint, selectedItem]);
  useEffect(() => { const handleClickOutside = (event: globalThis.MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false); }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, []);
  const handleSelect = useCallback((item: AutocompleteItem) => { setSearchTerm(item.nome); setSelectedItem(item); setIsOpen(false); onSelectionChange(item); }, [onSelectionChange]);
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => { const value = event.target.value; setSearchTerm(value); if (selectedItem && value !== selectedItem.nome) { setSelectedItem(null); onSelectionChange(null); } };

  return <div className="autocomplete-api-wrapper" ref={wrapperRef}><div className="autocomplete-input-container"><input type="text" className="fc-input" value={searchTerm} onChange={handleInputChange} placeholder={placeholder} onClick={() => { if (results.length > 0) setIsOpen(true); }} />{isLoading && <i className="fas fa-spinner fa-spin status-icon" />}{selectedItem && !isLoading && <i className="fas fa-check-circle status-icon success" />}{!selectedItem && debouncedSearchTerm.length > 1 && !isLoading && <i className="fas fa-times-circle status-icon error" />}</div>{isOpen && <div className="autocomplete-dropdown">{results.length > 0 ? results.map((item) => <div key={item.id} className="dropdown-item" onClick={() => handleSelect(item)}>{item.nome} <span className="item-type">[{item.tipo}]</span></div>) : <div className="dropdown-item-disabled">Nenhum resultado.</div>}</div>}</div>;
}
