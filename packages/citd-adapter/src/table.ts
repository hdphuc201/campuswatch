import { drift } from './errors.js';
import { cellText, foldText, ownText } from './text.js';
import { parseTermContext, type TermContext } from './values.js';

/**
 * Columns are found by header text, not by position, so reordered or extra columns keep
 * working. Aliases are folded (see `foldText`) and must match the whole header.
 */
export interface ColumnSpec<F extends string> {
  readonly aliases: Readonly<Record<F, readonly string[]>>;
  readonly required: readonly F[];
}

export type TableRow<F extends string> = Readonly<Record<F, string | undefined>>;

export interface ReadTable<F extends string> {
  readonly rows: TableRow<F>[];
  /** The cell elements behind `rows`, same order, for cells that hold several values. */
  readonly cells: Readonly<Record<F, Element | undefined>>[];
  /** Text of rows that are not data rows (for example summary rows with merged cells). */
  readonly extraText: string;
}

export interface LocatedTable {
  readonly table: HTMLTableElement;
  /** Nearest preceding "Học kỳ … năm học …" heading, caption, or selected option. */
  readonly context: TermContext | null;
  /** Text after the table (outside other data tables) until the next table or heading. */
  readonly trailingText: string;
}

const isLeafTable = (table: Element) => !table.querySelector('table');

const span = (cell: Element, name: 'colspan' | 'rowspan') =>
  Math.max(1, Number(cell.getAttribute(name)) || 1);

/**
 * Header rows (rows with `<th>` at the top, or the first row) resolved into one folded
 * header per column. Grouped headers spanning several rows/columns resolve to the bottom-most
 * label, e.g. "Điểm thành phần" over "QT | GK | CK" yields "qt", "gk", "ck".
 */
function resolveHeaders(table: HTMLTableElement): {
  headers: string[];
  headerRows: Set<HTMLTableRowElement>;
} {
  const rows = Array.from(table.rows);
  const headerRows: HTMLTableRowElement[] = [];
  for (const row of rows) {
    if (row.querySelector('th') || row.parentElement?.tagName === 'THEAD') {
      headerRows.push(row);
    } else if (headerRows.length > 0) {
      break;
    }
  }
  if (headerRows.length === 0 && rows[0]) {
    headerRows.push(rows[0]);
  }

  const grid: string[][] = headerRows.map(() => []);
  headerRows.forEach((row, r) => {
    let c = 0;
    for (const cell of Array.from(row.cells)) {
      while (grid[r]![c] !== undefined) {
        c += 1;
      }
      const text = foldText(cellText(cell));
      for (let dr = 0; dr < span(cell, 'rowspan') && r + dr < grid.length; dr += 1) {
        for (let dc = 0; dc < span(cell, 'colspan'); dc += 1) {
          grid[r + dr]![c + dc] = text;
        }
      }
      c += span(cell, 'colspan');
    }
  });
  const width = Math.max(0, ...grid.map((row) => row.length));
  const headers = Array.from({ length: width }, (_, c) => {
    for (let r = grid.length - 1; r >= 0; r -= 1) {
      const text = grid[r]![c];
      if (text !== undefined) {
        return text;
      }
    }
    return '';
  });
  return { headers, headerRows: new Set(headerRows) };
}

function mapColumns<F extends string>(
  headers: string[],
  spec: ColumnSpec<F>,
): { columns: Map<F, number>; missing: F[] } {
  const columns = new Map<F, number>();
  for (const field of Object.keys(spec.aliases) as F[]) {
    const index = headers.findIndex((header) => spec.aliases[field].includes(header));
    if (index >= 0) {
      columns.set(field, index);
    }
  }
  return { columns, missing: spec.required.filter((field) => !columns.has(field)) };
}

/** True when the table's header row has every required column. */
export function matchesSpec<F extends string>(table: HTMLTableElement, spec: ColumnSpec<F>) {
  return mapColumns(resolveHeaders(table).headers, spec).missing.length === 0;
}

/** How many required columns the header has: a partial match signals a changed layout. */
export function requiredColumnsFound<F extends string>(
  table: HTMLTableElement,
  spec: ColumnSpec<F>,
): number {
  return spec.required.length - mapColumns(resolveHeaders(table).headers, spec).missing.length;
}

export function readTable<F extends string>(
  table: HTMLTableElement,
  spec: ColumnSpec<F>,
  label: string,
): ReadTable<F> {
  const { headers, headerRows } = resolveHeaders(table);
  const { columns, missing } = mapColumns(headers, spec);
  if (missing.length > 0) {
    throw drift(`${label}: missing columns ${missing.join(', ')}`);
  }
  const lastRequired = Math.max(...spec.required.map((field) => columns.get(field)!));

  const rows: TableRow<F>[] = [];
  const cellRecords: Record<F, Element | undefined>[] = [];
  const extra: string[] = [];
  for (const row of Array.from(table.rows)) {
    if (headerRows.has(row)) {
      continue;
    }
    const cells = Array.from(row.cells);
    const texts = cells.map((cell) => cellText(cell));
    if (texts.every((text) => text === '')) {
      continue;
    }
    if (cells.length <= lastRequired) {
      extra.push(texts.join(' '));
      continue;
    }
    const record = {} as Record<F, string | undefined>;
    const cellRecord = {} as Record<F, Element | undefined>;
    for (const [field, index] of columns) {
      record[field] = texts[index];
      cellRecord[field] = cells[index];
    }
    rows.push(record);
    cellRecords.push(cellRecord);
  }
  return { rows, cells: cellRecords, extraText: extra.join(' ') };
}

/**
 * Walks the document in order and returns every data table with its term context. Layout
 * tables (tables that contain tables) are walked through, not returned.
 */
export function locateTables(doc: Document): LocatedTable[] {
  const located: { table: HTMLTableElement; context: TermContext | null; trailing: string[] }[] =
    [];
  let context: TermContext | null = null;
  let current: (typeof located)[number] | null = null;

  for (const element of Array.from(doc.body?.querySelectorAll('*') ?? [])) {
    if (element.tagName === 'TABLE') {
      if (!isLeafTable(element)) {
        continue;
      }
      const table = element as HTMLTableElement;
      const captionContext = table.caption ? parseTermContext(cellText(table.caption)) : null;
      current = { table, context: captionContext ?? context, trailing: [] };
      located.push(current);
      continue;
    }
    const enclosing = element.closest('table');
    if (enclosing && isLeafTable(enclosing)) {
      continue;
    }
    if (element.tagName === 'OPTION' && !element.hasAttribute('selected')) {
      continue;
    }
    if (element.tagName === 'SCRIPT' || element.tagName === 'STYLE') {
      continue;
    }
    const text = ownText(element);
    if (!text) {
      continue;
    }
    const heading = parseTermContext(text);
    if (heading) {
      context = heading;
      current = null;
      continue;
    }
    current?.trailing.push(text);
  }

  return located.map(({ table, context: tableContext, trailing }) => ({
    table,
    context: tableContext,
    trailingText: trailing.join(' '),
  }));
}

const EMPTY_STATE =
  /\b(chua co|khong co|khong tim thay)\b.*\b(du lieu|lich|diem|hoc phi|thong tin)\b/;

/**
 * Data tables of one kind. An explicit "no data yet" message yields `[]`; a table that has
 * only some of the expected columns, or no recognizable content at all, is layout drift.
 */
export function findDataTables<F extends string>(
  doc: Document,
  spec: ColumnSpec<F>,
  label: string,
): LocatedTable[] {
  const all = locateTables(doc);
  const matching = all.filter((entry) => matchesSpec(entry.table, spec));
  if (matching.length > 0) {
    return matching;
  }
  if (all.some((entry) => requiredColumnsFound(entry.table, spec) >= 2)) {
    throw drift(`${label}: table columns changed`);
  }
  if (EMPTY_STATE.test(foldText(doc.body?.textContent))) {
    return [];
  }
  throw drift(`${label}: table not found`);
}
