interface Props { text: string; color: 'blue' | 'purple' | 'gray' | 'orange' | 'green'; icon?: string; }

const colorClasses: Record<Props['color'], string> = { blue: 'badge-blue', purple: 'badge-purple', gray: 'badge-gray', orange: 'badge-orange', green: 'badge-green' };

export default function UIBadge({ text, color, icon }: Props) {
  return <span className={`fc-badge-pill ${colorClasses[color] || 'badge-gray'}`}>{icon && <i className={`fas ${icon}`} style={{ marginRight: '5px' }} />} {text}</span>;
}
