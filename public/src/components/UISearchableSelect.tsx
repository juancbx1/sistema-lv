import { useEffect, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { normalizeText } from '../utils/searchHelpers';

export interface SearchableOption { value: string | number; label: string; }
interface Props {
  options: SearchableOption[];
  placeholder?: string;
  onChange: (value: string | number | null) => void;
  initialValue?: string | number | null;
  maxVisible?: number;
}

export default function UISearchableSelect({
  options,
  placeholder,
  onChange,
  initialValue,
  maxVisible = 12,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedValue, setSelectedValue] = useState<string | number | null>(initialValue ?? null);
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((option) => option.value === selectedValue)?.label || '';
  const matchingOptions = searchTerm.length === 0
    ? options
    : options.filter((option) => normalizeText(option.label).includes(normalizeText(searchTerm)));
  const filteredOptions = matchingOptions.slice(0, maxVisible);

  useEffect(() => { setSelectedValue(initialValue ?? null); }, [initialValue]);
  useEffect(() => { const handleClickOutside = (event: globalThis.MouseEvent) => { if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) setIsOpen(false); }; document.addEventListener('mousedown', handleClickOutside); return () => document.removeEventListener('mousedown', handleClickOutside); }, []);
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => { setSearchTerm(event.target.value); setIsOpen(true); };
  const handleSelectOption = (value: string | number) => { setSelectedValue(value); onChange(value); setIsOpen(false); setSearchTerm(''); };
  const handleClear = (event: MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); setSelectedValue(null); onChange(null); setSearchTerm(''); };

  return <div className="searchable-select-wrapper" ref={wrapperRef}><div className="searchable-select-input-container"><input type="text" className="fc-input" placeholder={placeholder} value={selectedValue ? selectedLabel : searchTerm} onChange={handleInputChange} onClick={() => setIsOpen((open) => !open)} />{selectedValue && <button type="button" className="clear-btn" onClick={handleClear}><i className="fas fa-times" /></button>}</div>{isOpen && <div className="searchable-select-dropdown">{filteredOptions.length > 0 ? <>{filteredOptions.map((option) => <button type="button" key={option.value} className="dropdown-item" onClick={() => handleSelectOption(option.value)}>{option.label}</button>)}{matchingOptions.length > maxVisible && <div className="dropdown-item-disabled">Digite mais para refinar os {matchingOptions.length} resultados.</div>}</> : <div className="dropdown-item-disabled">Nenhum resultado encontrado.</div>}</div>}</div>;
}
