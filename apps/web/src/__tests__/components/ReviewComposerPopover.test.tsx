import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReviewComposerPopover } from '@/components/diff/review/ReviewComposerPopover.js';
vi.mock('@/components/diff/review/FloatingCard.js', () => ({ FloatingCard: ({children}: {children: React.ReactNode}) => <div>{children}</div> }));

describe('keyboard review line range', () => {
  it('rejects reversed and out-of-bounds ranges and submits valid keyboard input', () => {
    const onRangeChange = vi.fn();
    const onSubmit = vi.fn();
    render(<ReviewComposerPopover file={{path:'main.ts',alias:'main'}} range={{start:1,end:1,side:'additions'}} anchorPreview="line" anchor={{x:0,y:0}} lineCount={12} onRangeChange={onRangeChange} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox',{name:'Review comment'}), {target:{value:'Check this range'}});
    fireEvent.change(screen.getByRole('spinbutton',{name:'Start line'}), {target:{value:'3'}});
    expect(screen.getByRole('button',{name:'Add comment'})).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton',{name:'End line'}), {target:{value:'13'}});
    expect(screen.getByRole('button',{name:'Add comment'})).toBeDisabled();
    fireEvent.change(screen.getByRole('spinbutton',{name:'End line'}), {target:{value:'5'}});
    expect(onRangeChange).toHaveBeenLastCalledWith(3,5);
    fireEvent.keyDown(screen.getByRole('textbox',{name:'Review comment'}), {key:'Enter',ctrlKey:true});
    expect(onSubmit).toHaveBeenCalledWith('Check this range','fix');
  });
});
