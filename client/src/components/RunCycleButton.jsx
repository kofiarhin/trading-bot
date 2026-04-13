import { useState, useEffect } from 'react';
import { useCycleRuntime } from '../hooks/queries/useCycleRuntime.js';
import { useRunCycle } from '../hooks/mutations/useRunCycle.js';

export default function RunCycleButton() {
  const { data: runtime } = useCycleRuntime();
  const { mutate, isPending } = useRunCycle();
  const [message, setMessage] = useState(null);

  const isRunning = runtime?.status === 'running';
  const isDisabled = isPending || isRunning;

  const handleClick = () => {
    mutate(undefined, {
      onSuccess: () => setMessage('Manual cycle started'),
      onError: (err) => {
        const code = err?.response?.data?.code;
        setMessage(
          code === 'CYCLE_ALREADY_RUNNING' ? 'Cycle already running' : 'Failed to start cycle'
        );
      },
    });
  };

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(t);
  }, [message]);

  const label = isPending ? 'Starting...' : isRunning ? 'Cycle Running' : 'Run Cycle Now';

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={isDisabled}
        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
          isDisabled
            ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
            : 'bg-sky-600 hover:bg-sky-500 text-white cursor-pointer'
        }`}
      >
        {label}
      </button>
      {message && (
        <p className="text-xs text-slate-400">{message}</p>
      )}
    </div>
  );
}
