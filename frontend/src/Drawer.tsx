import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';

/** Native modal semantics provide focus containment, Escape and focus return. */
export function Drawer({
  open,
  onClose,
  title,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`drawer ${className}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
        }
      }}
    >
      <div className="drawer-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" autoFocus aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
