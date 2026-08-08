import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import UIBloqueio from './UIBloqueio';
import { mostrarPopupSemPermissao, temPermissao } from '../utils/bloqueio';

export interface UITabNavItem {
    id: string;
    label: string;
    icon?: string;
    badge?: ReactNode;
    badgeLabel?: string;
    dot?: boolean;
    dotLabel?: string;
    locked?: {
        permissao: string | readonly string[];
        mensagem?: string;
    };
}

interface UITabNavProps {
    items: readonly UITabNavItem[];
    activeId: string;
    onChange: (id: string) => void;
    ariaLabel: string;
}

interface SignalPosition {
    left: number;
}

export default function UITabNav({ items, activeId, onChange, ariaLabel }: UITabNavProps) {
    const navRef = useRef<HTMLElement | null>(null);
    const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
    const previousActiveId = useRef(activeId);
    const [signalPosition, setSignalPosition] = useState<SignalPosition>({ left: 0 });
    const [trackWidth, setTrackWidth] = useState(0);
    const [signalMoving, setSignalMoving] = useState(false);

    useLayoutEffect(() => {
        const updateSignalPosition = () => {
            const nav = navRef.current;
            if (!nav) return;

            setTrackWidth(nav.scrollWidth);

            const activeButton = buttonRefs.current[activeId];
            if (!activeButton) return;

            const navRect = nav.getBoundingClientRect();
            const buttonRect = activeButton.getBoundingClientRect();
            setSignalPosition({
                left: buttonRect.left - navRect.left + nav.scrollLeft + (buttonRect.width / 2),
            });
        };

        updateSignalPosition();
        window.addEventListener('resize', updateSignalPosition);
        navRef.current?.addEventListener('scroll', updateSignalPosition, { passive: true });

        const resizeObserver = typeof ResizeObserver === 'undefined'
            ? null
            : new ResizeObserver(updateSignalPosition);
        if (navRef.current) resizeObserver?.observe(navRef.current);

        const activeChanged = previousActiveId.current !== activeId;
        previousActiveId.current = activeId;
        let timer: number | undefined;
        if (activeChanged) {
            setSignalMoving(false);
            timer = window.setTimeout(() => setSignalMoving(true), 0);
            const clearMotion = window.setTimeout(() => setSignalMoving(false), 540);

            return () => {
                window.removeEventListener('resize', updateSignalPosition);
                navRef.current?.removeEventListener('scroll', updateSignalPosition);
                resizeObserver?.disconnect();
                if (timer !== undefined) window.clearTimeout(timer);
                window.clearTimeout(clearMotion);
            };
        }

        return () => {
            window.removeEventListener('resize', updateSignalPosition);
            navRef.current?.removeEventListener('scroll', updateSignalPosition);
            resizeObserver?.disconnect();
        };
    }, [activeId, items.length]);

    const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();

        const nextIndex = event.key === 'ArrowRight'
            ? (index + 1) % items.length
            : (index - 1 + items.length) % items.length;
        const nextItem = items[nextIndex];
        const nextBlocked = nextItem.locked ? !temPermissao(nextItem.locked.permissao) : false;
        buttonRefs.current[nextItem.id]?.focus();
        if (nextBlocked) {
            mostrarPopupSemPermissao(nextItem.locked?.mensagem);
            return;
        }
        onChange(nextItem.id);
    };

    return (
        <nav
            ref={navRef}
            className={`gs-tab-nav${items.some((item) => item.id === activeId) ? '' : ' sem-ativo'}`}
            role="tablist"
            aria-label={ariaLabel}
        >
            <span
                className="gs-tab-track"
                style={{ width: `${Math.max(trackWidth - 44, 0)}px` }}
                aria-hidden="true"
            />
            <span
                className={`gs-tab-signal${signalMoving ? ' is-moving' : ''}`}
                style={{ left: `${signalPosition.left}px` }}
                aria-hidden="true"
            />

            {items.map((item, index) => {
                const active = item.id === activeId;
                const accessibleStatus = item.dotLabel ? ` — ${item.dotLabel}` : '';
                const blocked = item.locked ? !temPermissao(item.locked.permissao) : false;

                const tabButton = (
                    <button
                        key={item.id}
                        ref={(element) => { buttonRefs.current[item.id] = element; }}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-disabled={blocked || undefined}
                        aria-label={`${item.label}${accessibleStatus}`}
                        className={`gs-tab-btn${active ? ' ativo' : ''}${signalMoving && active ? ' is-jumping' : ''}`}
                        onClick={() => {
                            if (blocked) {
                                mostrarPopupSemPermissao(item.locked?.mensagem);
                                return;
                            }
                            onChange(item.id);
                        }}
                        onKeyDown={(event) => handleKeyDown(event, index)}
                    >
                        {item.icon && <i className={`fas ${item.icon}`} aria-hidden="true" />}
                        <span
                            className={`gs-tab-label${item.label.trim().length > 15 ? ' gs-tab-label--longo' : ''}`}
                            title={item.label}
                        >
                            {item.label}
                        </span>
                        {item.badge !== undefined && (
                            <span className="gs-tab-badge" aria-label={item.badgeLabel}>{item.badge}</span>
                        )}
                        {item.dot && (
                            <span
                                className="gs-tab-dot"
                                title={item.dotLabel}
                                aria-label={item.dotLabel}
                            />
                        )}
                    </button>
                );

                if (!item.locked) return tabButton;

                return (
                    <UIBloqueio
                        key={item.id}
                        permissao={item.locked.permissao}
                        mensagem={item.locked.mensagem}
                    >
                        {tabButton}
                    </UIBloqueio>
                );
            })}
        </nav>
    );
}
