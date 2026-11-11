import { drift } from './errors.js';
import { cellText, foldText, ownText } from './text.js';
import {
  parseAcademicYearCell,
  parseSemesterCell,
  parseTermContext,
  type TermContext,
} from './values.js';

/** One "label → value" pair shown outside tables, e.g. `<p>Số tín chỉ tích luỹ</p><p>42</p>`. */
export interface LabeledValue {
  /** Folded label without a leading list number: "3. Học phí" → "hoc phi". */
  readonly label: string;
  readonly value: Element;
}

export interface LabeledSection {
  /** Term of the nearest preceding heading, `null` before the first term heading. */
  readonly context: TermContext | null;
  readonly fields: LabeledValue[];
}

const HEADING = new Set(['H1', 'H2', 'H3', 'H4', 'H5']);

/**
 * Label/value pairs in document order, grouped under the term headings that precede them.
 * A label is an element without child elements whose next sibling holds the value. Table
 * content is skipped: tables are read by column (see ./table.ts).
 */
export function readLabeledSections(doc: Document): LabeledSection[] {
  const sections: { context: TermContext | null; fields: LabeledValue[] }[] = [
    { context: null, fields: [] },
  ];
  for (const element of Array.from(doc.body?.querySelectorAll('*') ?? [])) {
    if (element.closest('table, script, style, select')) {
      continue;
    }
    if (HEADING.has(element.tagName)) {
      const context = parseTermContext(cellText(element));
      if (context) {
        sections.push({ context, fields: [] });
        continue;
      }
    }
    if (element.children.length > 0 || !element.nextElementSibling) {
      continue;
    }
    const label = foldText(ownText(element)).replace(/^\d{1,2} /, '');
    if (label) {
      sections.at(-1)!.fields.push({ label, value: element.nextElementSibling });
    }
  }
  return sections;
}

/** The first value whose label is one of `aliases` (folded, exact match). */
export function fieldValue(
  fields: readonly LabeledValue[],
  aliases: readonly string[],
): Element | undefined {
  return fields.find((field) => aliases.includes(field.label))?.value;
}

function selectedOptionText(select: HTMLSelectElement | null): string | null {
  if (!select) {
    return null;
  }
  const option = select.querySelector('option[selected]') ?? select.querySelector('option');
  return option ? cellText(option) : null;
}

/**
 * Term shown by a filtered page (timetable, exams): the selected semester and academic-year
 * options of its GET filter form, or "Học kỳ"/"Năm học" label/value pairs.
 */
export function selectedTerm(doc: Document, label: string): TermContext {
  const semester =
    selectedOptionText(doc.querySelector('select[name*="semester"]')) ??
    labeledText(doc, ['hoc ky']);
  const academicYear =
    selectedOptionText(doc.querySelector('select[name*="year"]')) ?? labeledText(doc, ['nam hoc']);
  if (semester === null || academicYear === null) {
    throw drift(`${label}: selected semester not found`);
  }
  return {
    semester: parseSemesterCell(semester, `${label}.semester`),
    academicYear: parseAcademicYearCell(academicYear, `${label}.academicYear`),
  };
}

function labeledText(doc: Document, aliases: readonly string[]): string | null {
  for (const section of readLabeledSections(doc)) {
    const value = fieldValue(section.fields, aliases);
    if (value) {
      return cellText(value);
    }
  }
  return null;
}
