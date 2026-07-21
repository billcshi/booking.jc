"use client";

import { useState } from "react";
import type { ReactNode } from "react";

export default function AdminPanel({
  eyebrow,
  title,
  description,
  count,
  defaultOpen = false,
  children,
  className = "",
}: {
  eyebrow: string;
  title: string;
  description?: string;
  count?: string;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <details
      className={`admin-panel ${className}`.trim()}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="admin-panel-heading">
          <span className="eyebrow">{eyebrow}</span>
          <span className="admin-panel-title" role="heading" aria-level={2}>
            {title}
          </span>
          {description && <span className="admin-panel-description">{description}</span>}
        </span>
        <span className="admin-panel-meta">
          {count && <span>{count}</span>}
          <i aria-hidden="true" />
        </span>
      </summary>
      <div className="admin-panel-body">{children}</div>
    </details>
  );
}
