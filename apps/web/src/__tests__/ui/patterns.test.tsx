import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BulkActionBar } from '@/ui/patterns/BulkActionBar/BulkActionBar.js';
import { DataTable, type DataTableColumn } from '@/ui/patterns/DataTable/DataTable.js';
import { PageTitle } from '@/ui/patterns/PageTitle/PageTitle.js';

interface Row {
  id: string;
  name: string;
  runs: number;
}

const ROWS: Row[] = [
  { id: 'a', name: 'Alpha', runs: 3 },
  { id: 'b', name: 'Beta', runs: 7 },
];

const COLUMNS: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', width: '1fr', cell: (r) => r.name },
  { id: 'runs', header: 'Runs', width: 60, align: 'end', sortable: true, cell: (r) => r.runs },
];

describe('DataTable (C-05)', () => {
  it('selects all rows and reports sort changes', () => {
    const onSelectionChange = vi.fn();
    const onSortChange = vi.fn();
    render(
      <DataTable<Row>
        label="Runs"
        columns={COLUMNS}
        rows={ROWS}
        getRowId={(r) => r.id}
        selection={new Set(['a'])}
        onSelectionChange={onSelectionChange}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute('aria-checked', 'mixed');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['a', 'b']));
    fireEvent.click(screen.getByRole('button', { name: /Runs/ }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'runs', direction: 'descending' });
  });

  it('replaces the table with the empty / error node and shows skeletons while loading', () => {
    const { rerender } = render(
      <DataTable<Row> label="Runs" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} empty={<p>Nothing yet</p>} />,
    );
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    rerender(<DataTable<Row> label="Runs" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} error={<p>503</p>} empty={<p>Nothing yet</p>} />);
    expect(screen.getByText('503')).toBeInTheDocument();
    rerender(<DataTable<Row> label="Runs" columns={COLUMNS} rows={[]} getRowId={(r) => r.id} loading />);
    expect(screen.getByRole('table', { name: 'Runs' })).toHaveAttribute('aria-busy', 'true');
  });
});

describe('BulkActionBar (C-06)', () => {
  it('renders nothing at 0 and clears on Escape', () => {
    const onClear = vi.fn();
    const { rerender } = render(<BulkActionBar count={0} actions={null} onClear={onClear} />);
    expect(screen.queryByRole('toolbar')).toBeNull();
    rerender(<BulkActionBar count={2} total={10} actions={null} onClear={onClear} onSelectAll={() => undefined} />);
    expect(screen.getByRole('toolbar', { name: 'Bulk actions' })).toHaveTextContent('2 selected');
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClear).toHaveBeenCalledOnce();
  });
});

describe('PageTitle (C-03)', () => {
  it('joins detail meta with middots', () => {
    const { container } = render(<PageTitle variant="detail" title="Audit" meta={['wf_1', 'v7']} />);
    expect(container.textContent).toContain('wf_1·v7');
  });
});
