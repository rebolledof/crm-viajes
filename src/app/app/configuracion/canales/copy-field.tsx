"use client";

import { useState } from "react";
import { Icon } from "@/components/icons";

/** Texto para copiar (enlace o código) con un botón "Copiar". */
export function CopyField({ id, label, value, multiline }: { id: string; label: string; value: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  const cls = "w-full rounded border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs text-slate-900";
  return (
    <div className="flex flex-col gap-1 text-sm">
      <label htmlFor={id} className="font-medium text-slate-700">{label}</label>
      <div className="flex items-start gap-2">
        {multiline ? (
          <textarea id={id} readOnly value={value} rows={3} onFocus={(e) => e.currentTarget.select()} className={cls} />
        ) : (
          <input id={id} readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={cls} />
        )}
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-surface px-3 py-2 text-sm font-medium text-brand-text hover:bg-slate-50"
        >
          <Icon name={copied ? "done" : "link"} className="size-4" />
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}
