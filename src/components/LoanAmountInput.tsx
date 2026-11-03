import { useLayoutEffect, useRef, useState } from 'react';
import { Input } from './ui/input';

// Keep the calculator's value unformatted; commas are only presentation.
function groupAmount(value: string) {
  const [whole, fraction] = value.split('.');
  return (
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === undefined ? '' : `.${fraction}`)
  );
}

export function LoanAmountInput({
  id,
  value,
  onValueChange,
}: {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selection, setSelection] = useState<{ position: number } | null>(null);
  useLayoutEffect(() => {
    if (selection) input.current?.setSelectionRange(selection.position, selection.position);
  }, [selection, value]);

  return (
    <Input
      ref={input}
      id={id}
      type="text"
      inputMode="decimal"
      value={groupAmount(value)}
      onChange={(event) => {
        const entered = event.target.value;
        const raw = entered.replace(/,/g, '');
        if (!/^\d*(\.\d*)?$/.test(raw)) return;
        const beforeCaret = entered
          .slice(0, event.target.selectionStart ?? entered.length)
          .replace(/,/g, '').length;
        const formatted = groupAmount(raw);
        let position = 0;
        let characters = 0;
        while (position < formatted.length && characters < beforeCaret) {
          if (formatted[position] !== ',') characters++;
          position++;
        }
        setSelection({ position });
        onValueChange(raw);
      }}
    />
  );
}
