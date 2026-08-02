/** 提示词历史弹窗（自 app.tsx 拆分） */
import { useState, type JSX } from 'react';
import { History, Search, X } from 'lucide-react';

export function SearchHistoryModal({
  onClose,
  onSelect,
  prompts,
}: {
  onClose: () => void;
  onSelect: (txt: string) => void;
  prompts: string[];
}): JSX.Element {
  const [query, setQuery] = useState('');
  const history = prompts.filter((prompt) =>
    prompt.toLocaleLowerCase('en-US').includes(query.toLocaleLowerCase('en-US')),
  );
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col items-center pt-[15vh] p-4 animate-in fade-in duration-200">
      <div
        aria-label="提示词历史"
        aria-modal="true"
        className="bg-[#18181b] border border-border w-full max-w-2xl rounded-xl shadow-2xl flex flex-col animate-in slide-in-from-top-10 duration-200"
        role="dialog"
      >
        <div className="flex items-center px-4 py-3 border-b border-border/50 bg-[#09090b] rounded-t-xl">
          <Search size={16} className="text-muted-foreground mr-3" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            type="text"
            placeholder="搜索提示词历史..."
            autoFocus
            className="flex-1 bg-transparent border-none outline-none text-sm text-foreground"
          />
          <button
            aria-label="关闭提示词历史"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            type="button"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-2 space-y-1 max-h-[40vh] overflow-y-auto">
          {history.map((txt, i) => (
            <button
              key={i}
              onClick={() => onSelect(txt)}
              className="w-full text-left p-3 text-[13px] text-muted-foreground hover:text-foreground hover:bg-secondary/50 rounded-lg transition-colors flex items-start gap-3"
              type="button"
            >
              <History size={14} className="mt-0.5 shrink-0 opacity-50" />
              {txt}
            </button>
          ))}
          {history.length === 0 && (
            <div className="px-3 py-5 text-[13px] text-muted-foreground">暂无历史提示词</div>
          )}
        </div>
      </div>
    </div>
  );
}
