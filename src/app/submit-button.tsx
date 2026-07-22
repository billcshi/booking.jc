"use client";

import { useFormStatus } from "react-dom";

export default function SubmitButton({
  children,
  pendingLabel,
  className,
  confirmMessage,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  confirmMessage?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending || disabled} aria-disabled={pending || disabled}
      onClick={(event) => { if (confirmMessage && !window.confirm(confirmMessage)) event.preventDefault(); }}>
      {pending ? pendingLabel : children}
    </button>
  );
}
