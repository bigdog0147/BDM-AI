"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icons";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A keyboard-safe dialog.
 *
 * Focus moves into the dialog on open, Escape closes it, Tab is trapped
 * inside it, and focus returns to the element that opened it. The backdrop
 * only closes on a click that starts and ends on the backdrop itself.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  size = "default"
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  size?: "default" | "wide";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusable = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (element) => element.offsetParent !== null || element === document.activeElement
      );

    const timer = window.setTimeout(() => {
      const items = focusable();
      (items[0] ?? panel)?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${size === "wide" ? "modal-wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
      >
        {title ? (
          <div className="modal-head">
            <h2 className="modal-title">{title}</h2>
            <button
              type="button"
              className="icon-btn"
              onClick={onClose}
              aria-label="Close dialog"
            >
              <Icon name="close" size={18} />
            </button>
          </div>
        ) : null}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
