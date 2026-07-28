interface Props { icon: string; title: string; message: string; }
export default function UINaoEncontradoBusca({ icon, title, message }: Props) { return <div className="fc-nao-encontrado-container"><div className="nao-encontrado-icone"><i className={`fas ${icon}`} /></div><h4 className="nao-encontrado-titulo">{title}</h4><p className="nao-encontrado-mensagem">{message}</p></div>; }
