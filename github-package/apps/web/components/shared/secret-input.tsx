"use client";

import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

type SecretInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

export const SecretInput = forwardRef<HTMLInputElement, SecretInputProps>(function SecretInput(
  { className = "", placeholder = "留空表示不修改原密钥", ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        placeholder={placeholder}
        className={`h-10 w-full rounded-md border border-slate-200 bg-white px-3 pr-10 text-sm text-slate-950 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${className}`}
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        className="absolute right-1.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
        aria-label={visible ? "隐藏密钥" : "显示密钥"}
      >
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  );
});
