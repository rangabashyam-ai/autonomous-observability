import React, { useState } from 'react';

interface CopyButtonProps {
  text: string;
  label?: string;
}

export default function CopyButton({ text, label = 'Copy ID' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="ml-2 px-2 py-1 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-600 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? '✔️' : label}
    </button>
  );
}
