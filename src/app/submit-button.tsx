"use client";

import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useI18n } from "./locale-provider";

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
  const { t } = useI18n();
  const [confirming,setConfirming]=useState(false), dialog=useRef<HTMLDialogElement>(null), titleId=useId(), bypass=useRef(false);
  const submit=()=>{bypass.current=true;setConfirming(false);dialog.current?.close();dialog.current?.closest("form")?.requestSubmit();};
  return (
    <>
      <button className={className} disabled={pending || disabled} aria-disabled={pending || disabled}
        onClick={(event) => {if(bypass.current){bypass.current=false;return}if(confirmMessage&&!confirming){event.preventDefault();dialog.current?.showModal();}}}>
        {pending ? pendingLabel : children}
      </button>
      {confirmMessage&&<dialog ref={dialog} aria-labelledby={titleId} onClose={()=>setConfirming(false)}>
        <p id={titleId}>{confirmMessage}</p><div className="actions"><button type="button" onClick={()=>dialog.current?.close()}>{t("取消")}</button><button type="button" className={className} onClick={()=>{setConfirming(true);submit();}}>{children}</button></div>
      </dialog>}
      <span className="sr-only" aria-live="polite">{pending?pendingLabel:""}</span>
    </>
  );
}
